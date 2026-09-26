use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::{Column, Executor, SqlSafeStr};
use tauri::State;

use super::{primary_key_columns, quote_ident, AppContext};

/// Cap on rows returned by an arbitrary or browse query — the Postgres sibling of
/// `AGG_RESULT_CAP` for Mongo's `run_aggregate`. Requested as `<cap>+1` so
/// truncation is detectable without a second `COUNT(*)` round trip.
const ROW_RESULT_CAP: i64 = 10_000;

/// Default page size for `browse_pg_table` when the caller sends a non-positive
/// `limit` — mirrors `find_documents`' `FIND_LIMIT_FALLBACK`.
const BROWSE_LIMIT_FALLBACK: i64 = 100;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgQueryResult {
    /// Column names in the query's own order, from the statement's describe —
    /// never inferred from a decoded row's own shape (see `run_wrapped`'s doc
    /// comment for why: two columns can share a name, or have none at all).
    pub columns: Vec<String>,
    /// One array of values per row, aligned to `columns` by position — not one
    /// JSON object per row, which would silently collapse duplicate column names.
    pub rows: Vec<Vec<serde_json::Value>>,
    pub truncated: bool,
    pub elapsed_ms: u64,
}

/// Wraps `inner_sql` — one subquery-able SELECT/CTE/VALUES expression — so every
/// row comes back as a JSON array via Postgres's own `to_json`, sidestepping a
/// per-Postgres-type Rust-side decoder entirely: whatever the query returns, the
/// server already knows how to render as JSON. This is also why `run_pg_query`
/// only supports queries, not arbitrary statements — the wrapper below is only
/// valid SQL when `inner_sql` is something a `FROM` clause can wrap, which
/// INSERT/UPDATE/DELETE/DDL are not.
///
/// Column names come from a separate `describe()` of `inner_sql` alone, not from
/// the wrapped query or the decoded rows: `to_json` renders a row as a JSON
/// *object*, whose keys silently collapse when two columns share a name (a join
/// on `id`) or have none (`SELECT 1, 2`, both named `?column?`) — confirmed
/// against a live server, losing a real column each time. The wrapper below
/// works around this the same way: it aliases `inner_sql`'s columns positionally
/// (`AS t(c0, c1, …)`, never by name) and returns `json_build_array(...)`, an
/// array, not an object, so position — not a possibly-duplicate name — is what
/// ties a decoded value back to `columns`.
///
/// `NUMERIC` columns are cast to `text` before `to_json` sees them: Postgres
/// renders `numeric` with its full, arbitrary precision, but this crate's
/// `serde_json` is built without `arbitrary_precision`, so decoding that back as
/// a bare JSON number would silently round it to the nearest `f64` — including a
/// numeric primary key, which would then fail to match anything in
/// `update_pg_row`. Sent as a JSON string instead, the exact text survives.
async fn run_wrapped(pool: &sqlx::PgPool, inner_sql: &str) -> Result<PgQueryResult, AppError> {
    let described = match pool
        .describe(sqlx::AssertSqlSafe(inner_sql.to_string()).into_sql_str())
        .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    let columns: Vec<String> = described.columns().iter().map(|c| c.name().to_string()).collect();
    if columns.is_empty() {
        return Ok(PgQueryResult { columns, rows: Vec::new(), truncated: false, elapsed_ms: 0 });
    }

    let exprs: Vec<String> = described
        .columns()
        .iter()
        .enumerate()
        .map(|(i, col)| {
            let alias = format!("c{i}");
            if col.type_info().to_string().eq_ignore_ascii_case("numeric") {
                format!("to_json((t.{alias})::text)")
            } else {
                format!("to_json(t.{alias})")
            }
        })
        .collect();
    let aliases: Vec<String> = (0..columns.len()).map(|i| format!("c{i}")).collect();

    // The newline before the closing paren matters: without it, an `inner_sql`
    // ending in a `--` line comment (e.g. `SELECT 1 AS a -- note`) would comment
    // out the `) AS t(...)` that follows on the same line — confirmed against a
    // live server, "syntax error at end of input".
    let wrapped = format!(
        "SELECT json_build_array({}) AS row FROM ({inner_sql}\n) AS t({}) LIMIT {}",
        exprs.join(", "),
        aliases.join(", "),
        ROW_RESULT_CAP + 1,
    );

    let started = std::time::Instant::now();
    let mut raw_rows: Vec<serde_json::Value> =
        match sqlx::query_scalar::<_, serde_json::Value>(sqlx::AssertSqlSafe(wrapped))
            .fetch_all(pool)
            .await
        {
            Ok(val) => val,
            Err(e) => return Err(AppError::Postgres(e)),
        };
    let elapsed_ms = started.elapsed().as_millis() as u64;

    let truncated = raw_rows.len() > ROW_RESULT_CAP as usize;
    if truncated {
        raw_rows.truncate(ROW_RESULT_CAP as usize);
    }
    // `json_build_array` always yields a JSON array; the fallback only guards
    // against that guarantee somehow not holding, rather than panicking.
    let rows: Vec<Vec<serde_json::Value>> = raw_rows
        .into_iter()
        .map(|row| match row {
            serde_json::Value::Array(values) => values,
            other => vec![other],
        })
        .collect();

    Ok(PgQueryResult { columns, rows, truncated, elapsed_ms })
}

pub(crate) async fn run_query_impl(pool: &sqlx::PgPool, sql: &str) -> Result<PgQueryResult, AppError> {
    let trimmed = sql.trim().trim_end_matches(';');
    if trimmed.is_empty() {
        return Err(AppError::Validation("Enter a query to run.".to_string()));
    }
    run_wrapped(pool, trimmed).await
}

/// Runs arbitrary read-oriented SQL (a single SELECT, CTE, or VALUES expression)
/// and returns every row — the SQL editor workspace's core. A general
/// SQL-*execution* surface (INSERT/UPDATE/DELETE/DDL, multiple statements) is out
/// of v1's scope; see `run_wrapped`'s doc comment for why those fail with a
/// Postgres syntax error here rather than running.
///
/// This still reaches the driver through `pg_pool`, not `pg_pool_for_write` — a
/// `read_only` connection can't skip this check by construction, but a wrapped
/// subquery only rules out statements that can't live in a `FROM` clause, not a
/// volatile function usable inside one (`nextval`, `setval`,
/// `pg_terminate_backend`, …). The real enforcement is server-side: see
/// `pg_uri::options_for`'s `default_transaction_read_only` for `read_only`
/// connections, which `pg_pool` and `pg_pool_for_write` both dial through.
#[tauri::command]
pub async fn run_pg_query(
    ctx: State<'_, AppContext>,
    id: String,
    sql: String,
) -> Result<PgQueryResult, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    run_query_impl(&pool, &sql).await
}

pub(crate) async fn browse_table_impl(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
    order_by: Option<&str>,
    descending: bool,
    limit: i64,
    offset: i64,
) -> Result<PgQueryResult, AppError> {
    let qualified = format!("{}.{}", quote_ident(schema)?, quote_ident(table)?);
    let effective_limit = if limit <= 0 { BROWSE_LIMIT_FALLBACK } else { limit.min(ROW_RESULT_CAP) };
    let effective_offset = offset.max(0);

    // `LIMIT`/`OFFSET` alone promise nothing about which rows land on which page
    // — without an `ORDER BY`, Postgres is free to return them in a different
    // order on every call, so rows can repeat or vanish between pages. An
    // explicit `order_by` is quoted and used as given; absent one, this falls
    // back to the primary key (stable and always unique) rather than paging
    // unordered. A table with no primary key still pages, just without that
    // guarantee — nothing safe to default to in that case.
    let order_columns: Vec<String> = match order_by.filter(|s| !s.is_empty()) {
        Some(col) => vec![quote_ident(col)?],
        None => {
            let pk = primary_key_columns(pool, schema, table).await?;
            let mut quoted = Vec::with_capacity(pk.len());
            for column in &pk {
                quoted.push(quote_ident(column)?);
            }
            quoted
        }
    };

    let mut inner = format!("SELECT * FROM {qualified}");
    if !order_columns.is_empty() {
        let direction = if descending { "DESC" } else { "ASC" };
        inner.push_str(&format!(" ORDER BY {} {direction}", order_columns.join(", ")));
    }
    inner.push_str(&format!(" LIMIT {effective_limit} OFFSET {effective_offset}"));

    run_wrapped(pool, &inner).await
}

/// Paged `SELECT *` over one table or view — the table-browse workspace's core.
/// `order_by`, when given, is quoted as an identifier and nothing more: an
/// unknown column name fails with Postgres's own "column does not exist" rather
/// than being validated against `list_pg_columns` again here.
#[tauri::command]
pub async fn browse_pg_table(
    ctx: State<'_, AppContext>,
    id: String,
    schema: String,
    table: String,
    order_by: Option<String>,
    descending: bool,
    limit: i64,
    offset: i64,
) -> Result<PgQueryResult, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    browse_table_impl(&pool, &schema, &table, order_by.as_deref(), descending, limit, offset).await
}

pub(crate) async fn count_table_impl(pool: &sqlx::PgPool, schema: &str, table: &str) -> Result<i64, AppError> {
    let qualified = format!("{}.{}", quote_ident(schema)?, quote_ident(table)?);
    match sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {qualified}")))
        .fetch_one(pool)
        .await
    {
        Ok(val) => Ok(val),
        Err(e) => Err(AppError::Postgres(e)),
    }
}

/// Total row count for `browse_pg_table`'s pagination — a separate call rather
/// than folded into the browse result, so paging to page 2 doesn't pay for a
/// fresh `COUNT(*)` on every page the way a naive combined query would.
#[tauri::command]
pub async fn count_pg_table(ctx: State<'_, AppContext>, id: String, schema: String, table: String) -> Result<i64, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    count_table_impl(&pool, &schema, &table).await
}

#[derive(Deserialize)]
pub struct ColumnValue {
    pub column: String,
    pub value: serde_json::Value,
}

/// Renders a JSON value as the text Postgres's own input parser expects behind a
/// `$n::type` cast — the same "send everything as text, let the server parse it"
/// approach libpq's simple protocol uses, so one function covers integers,
/// booleans, timestamps, uuids, arrays, enums, … without a per-Postgres-type Rust
/// encoder. `None` means a real SQL `NULL` (bound, not the text "null" — casting
/// `NULL` to any type is always fine, so the caller never special-cases this).
///
/// `json`/`jsonb` are the one type family this can't treat like a plain scalar:
/// a JSON *string* value (`"hi"`) must reach Postgres as the text `"hi"` — quotes
/// included — because that's what a `json`/`jsonb` column actually stores; the
/// bare text `hi` isn't valid JSON input at all. So for those two types this
/// always serializes with `value.to_string()`, the same as the array/object arm
/// below already did, rather than passing a JSON string's own contents through
/// unquoted the way every other text-like column wants.
fn stringify_param(value: &serde_json::Value, pg_type: &str) -> Option<String> {
    if pg_type.eq_ignore_ascii_case("json") || pg_type.eq_ignore_ascii_case("jsonb") {
        return match value {
            serde_json::Value::Null => None,
            other => Some(other.to_string()),
        };
    }
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::Bool(b) => Some(b.to_string()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::String(s) => Some(s.clone()),
        // Not generally valid for a real Postgres ARRAY column (whose input
        // syntax is `{a,b}`, not JSON) — but is exactly what an enum or a
        // composite type's text input expects for its sub-fields, and is at
        // least explicit, reviewable behavior rather than a silent truncation.
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => Some(value.to_string()),
    }
}

async fn column_types(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
) -> Result<std::collections::BTreeMap<String, String>, AppError> {
    // `format_type`, not `information_schema.columns.data_type`: the latter
    // drops the length/precision modifier (`character(10)` and `character(1)`
    // both report plain "character" — a `char(10)` column then truncates any
    // update past one character) and reports the non-castable placeholders
    // "ARRAY"/"USER-DEFINED" for array and enum columns instead of a real,
    // `::`-castable type name.
    let rows: Vec<(String, String)> = match sqlx::query_as(
        r#"
        SELECT a.attname, format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
            AND a.attnum > 0 AND NOT a.attisdropped
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    Ok(rows.into_iter().collect())
}

fn column_cast<'a>(
    types: &'a std::collections::BTreeMap<String, String>,
    column: &str,
) -> Result<&'a str, AppError> {
    match types.get(column) {
        Some(data_type) => Ok(data_type.as_str()),
        None => Err(AppError::Validation(format!("Unknown column \"{column}\"."))),
    }
}

pub(crate) async fn update_row_impl(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
    set: &[ColumnValue],
    r#where: &[ColumnValue],
) -> Result<u64, AppError> {
    if set.is_empty() {
        return Err(AppError::Validation("Nothing to update.".to_string()));
    }
    if r#where.is_empty() {
        return Err(AppError::Validation(
            "This table has no primary key, so a row can't be identified for editing.".to_string(),
        ));
    }

    // A row identified by less than its full primary key could match more than
    // one row — verify the given WHERE columns cover the real key, rather than
    // trusting the caller to have gotten it right, no matter which caller.
    let pk = primary_key_columns(pool, schema, table).await?;
    if pk.is_empty() {
        return Err(AppError::Validation(
            "This table has no primary key, so a row can't be safely identified for editing.".to_string(),
        ));
    }
    let where_columns: std::collections::BTreeSet<String> =
        r#where.iter().map(|item| item.column.clone()).collect();
    if !pk.is_subset(&where_columns) {
        return Err(AppError::Validation(
            "The row identifier must include every primary-key column.".to_string(),
        ));
    }

    let types = column_types(pool, schema, table).await?;
    let qualified = format!("{}.{}", quote_ident(schema)?, quote_ident(table)?);

    let mut sql = format!("UPDATE {qualified} SET ");
    let mut binds: Vec<Option<String>> = Vec::new();
    let mut param = 0;
    for (i, item) in set.iter().enumerate() {
        let pg_type = column_cast(&types, &item.column)?;
        param += 1;
        if i > 0 {
            sql.push_str(", ");
        }
        sql.push_str(&format!("{} = ${param}::{pg_type}", quote_ident(&item.column)?));
        binds.push(stringify_param(&item.value, pg_type));
    }
    sql.push_str(" WHERE ");
    for (i, item) in r#where.iter().enumerate() {
        let pg_type = column_cast(&types, &item.column)?;
        param += 1;
        if i > 0 {
            sql.push_str(" AND ");
        }
        sql.push_str(&format!("{} = ${param}::{pg_type}", quote_ident(&item.column)?));
        binds.push(stringify_param(&item.value, pg_type));
    }

    // `sql` interpolates only quoted identifiers (`quote_ident`, checked against
    // `types`/the primary key above) and `$n::type` placeholders — every actual
    // value is bound below, never spliced into the text.
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
    for bind in binds {
        query = query.bind(bind);
    }
    match query.execute(pool).await {
        Ok(result) => Ok(result.rows_affected()),
        Err(e) => Err(AppError::Postgres(e)),
    }
}

/// Updates one row, identified by `where` — its primary-key column(s) and their
/// original values, which the frontend gets from `list_pg_columns`'
/// `is_primary_key` flag — with the column/value pairs in `set`. A primary key is
/// required: matching a row by its full original content (the alternative when
/// there is no key) breaks on duplicate rows and on large values alike. Returns
/// the number of rows affected — 1 on a normal edit; 0 means the row no longer
/// matches (edited or deleted since it was fetched), which the caller should
/// treat as a conflict, not silently ignore.
#[tauri::command]
pub async fn update_pg_row(
    ctx: State<'_, AppContext>,
    id: String,
    schema: String,
    table: String,
    set: Vec<ColumnValue>,
    r#where: Vec<ColumnValue>,
) -> Result<u64, AppError> {
    let pool = ctx.pg_pool_for_write(&id).await?;
    update_row_impl(&pool, &schema, &table, &set, &r#where).await
}

#[cfg(test)]
#[path = "query.test.rs"]
mod tests;
