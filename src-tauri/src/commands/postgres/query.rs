use crate::error::AppError;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{primary_key_columns, quote_ident, AppContext};

/// Cap on rows returned by an arbitrary or browse query — the Postgres sibling of
/// `AGG_RESULT_CAP` for Mongo's `run_aggregate`. Requested as `<cap>+1` so
/// truncation is detectable without a second `COUNT(*)` round trip.
const ROW_RESULT_CAP: i64 = 10_000;

/// Default page size for `browse_pg_table` when the caller sends a non-positive
/// `limit` — mirrors `find_documents`' `FIND_LIMIT_FALLBACK`.
const BROWSE_LIMIT_FALLBACK: i64 = 100;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgQueryResult {
    /// Column names in their query order, taken from the first row's own keys
    /// (this crate already builds with serde_json's `preserve_order`, so decoded
    /// object keys come back in whatever order the JSON text had them in — see
    /// `run_wrapped`'s doc comment for why that means `to_json`, not `to_jsonb`).
    /// Empty when the query returned zero rows — there is nothing to take them
    /// from, and no separate DESCRIBE round trip is made just to fill this in.
    pub columns: Vec<String>,
    pub rows: Vec<serde_json::Value>,
    pub truncated: bool,
    pub elapsed_ms: u64,
}

/// Wraps `inner_sql` — one subquery-able SELECT/CTE/VALUES expression — so every
/// row comes back as a single JSON object via Postgres's own `to_json`,
/// sidestepping a per-Postgres-type Rust-side decoder entirely: whatever the
/// query returns, the server already knows how to render as JSON. `to_json`, not
/// `to_jsonb`: `jsonb` is a decomposed binary format that does not preserve key
/// order (confirmed against a live server — `to_jsonb` came back with columns
/// reordered), while `json` stores the serialized text as-is, so the object's
/// keys land in the row's actual column order. This is also why `run_pg_query`
/// only supports queries, not arbitrary statements — `to_json(t) FROM (<sql>) AS
/// t` is only valid SQL when `<sql>` is something a FROM clause can wrap, which
/// INSERT/UPDATE/DELETE/DDL are not.
async fn run_wrapped(pool: &sqlx::PgPool, inner_sql: &str) -> Result<PgQueryResult, AppError> {
    let wrapped = format!(
        "SELECT to_json(t) AS row FROM ({inner_sql}) AS t LIMIT {}",
        ROW_RESULT_CAP + 1
    );
    let started = std::time::Instant::now();
    // `wrapped` is built from `inner_sql`, which every caller assembles from
    // quoted identifiers (`quote_ident`) and either a formatted integer (LIMIT/
    // OFFSET) or the caller's own arbitrary read query (`run_pg_query`, whose
    // whole point is running caller-supplied SQL) — reviewed, not unaudited.
    let mut rows: Vec<serde_json::Value> =
        match sqlx::query_scalar::<_, serde_json::Value>(sqlx::AssertSqlSafe(wrapped))
            .fetch_all(pool)
            .await
        {
            Ok(val) => val,
            Err(e) => return Err(AppError::Postgres(e)),
        };
    let elapsed_ms = started.elapsed().as_millis() as u64;

    let truncated = rows.len() > ROW_RESULT_CAP as usize;
    if truncated {
        rows.truncate(ROW_RESULT_CAP as usize);
    }
    let columns = match rows.first() {
        Some(serde_json::Value::Object(map)) => map.keys().cloned().collect(),
        _ => Vec::new(),
    };
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
/// and returns every row as a JSON object — the SQL editor workspace's core. A
/// general SQL-*execution* surface (INSERT/UPDATE/DELETE/DDL, multiple
/// statements) is out of v1's scope; see `run_wrapped`'s doc comment for why
/// those fail with a Postgres syntax error here rather than running.
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

    let mut inner = format!("SELECT * FROM {qualified}");
    if let Some(col) = order_by.filter(|s| !s.is_empty()) {
        let direction = if descending { "DESC" } else { "ASC" };
        inner.push_str(&format!(" ORDER BY {} {direction}", quote_ident(col)?));
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
/// booleans, timestamps, uuids, jsonb, … without a per-Postgres-type Rust encoder.
/// `None` means a real SQL `NULL` (bound, not the text "null" — casting `NULL` to
/// any type is always fine, so the caller never special-cases this).
fn stringify_param(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::Bool(b) => Some(b.to_string()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::String(s) => Some(s.clone()),
        // Postgres's `json`/`jsonb` input functions parse this directly; a real
        // Postgres ARRAY column needs `{...}` array-literal syntax instead, which
        // is exactly why `is_castable_type` refuses to reach this arm for one.
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => Some(value.to_string()),
    }
}

/// Whether `update_pg_row` can safely cast a bound text parameter to this
/// `information_schema.columns.data_type`. Rejects `ARRAY` — the view reports
/// every array column's type as that bare string, with the actual element type
/// only in `udt_name`/`pg_catalog`, not enough to build a valid `::type` cast —
/// and `USER-DEFINED` (enums, composite/custom types: same problem, `data_type`
/// doesn't name a castable type). Editing either is a possible later
/// improvement, not a v1 gap worth guessing around.
fn is_castable_type(data_type: &str) -> bool {
    data_type != "ARRAY" && data_type != "USER-DEFINED"
}

async fn column_types(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
) -> Result<std::collections::BTreeMap<String, String>, AppError> {
    let rows: Vec<(String, String)> = match sqlx::query_as(
        "SELECT column_name, data_type FROM information_schema.columns \
         WHERE table_schema = $1 AND table_name = $2",
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
        Some(data_type) if is_castable_type(data_type) => Ok(data_type.as_str()),
        Some(_) => Err(AppError::Validation(format!(
            "Column \"{column}\" isn't editable yet (array and custom types aren't supported)."
        ))),
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
        binds.push(stringify_param(&item.value));
    }
    sql.push_str(" WHERE ");
    for (i, item) in r#where.iter().enumerate() {
        let pg_type = column_cast(&types, &item.column)?;
        param += 1;
        if i > 0 {
            sql.push_str(" AND ");
        }
        sql.push_str(&format!("{} = ${param}::{pg_type}", quote_ident(&item.column)?));
        binds.push(stringify_param(&item.value));
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
mod tests {
    use super::{is_castable_type, stringify_param};
    use serde_json::json;

    #[test]
    fn stringify_renders_scalars_as_plain_text() {
        assert_eq!(stringify_param(&json!(true)), Some(String::from("true")));
        assert_eq!(stringify_param(&json!(42)), Some(String::from("42")));
        assert_eq!(stringify_param(&json!(3.5)), Some(String::from("3.5")));
        assert_eq!(stringify_param(&json!("hello")), Some(String::from("hello")));
    }

    #[test]
    fn stringify_renders_null_as_a_real_sql_null() {
        assert_eq!(stringify_param(&serde_json::Value::Null), None);
    }

    #[test]
    fn stringify_renders_containers_as_json_text() {
        assert_eq!(stringify_param(&json!({"a": 1})), Some(String::from("{\"a\":1}")));
        assert_eq!(stringify_param(&json!([1, 2])), Some(String::from("[1,2]")));
    }

    #[test]
    fn castable_type_accepts_ordinary_types_and_rejects_array_and_user_defined() {
        assert!(is_castable_type("integer"));
        assert!(is_castable_type("character varying"));
        assert!(is_castable_type("timestamp without time zone"));
        assert!(!is_castable_type("ARRAY"));
        assert!(!is_castable_type("USER-DEFINED"));
    }
}
