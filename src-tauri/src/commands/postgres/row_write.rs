use crate::error::AppError;
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{array_literal::array_literal, primary_key_columns, quote_ident, AppContext};

#[derive(Deserialize, Serialize, Clone, Debug)]
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
        serde_json::Value::Array(items) if pg_type.ends_with("[]") => Some(array_literal(items)),
        // Anything else structured goes as its JSON text rather than being truncated.
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => Some(value.to_string()),
    }
}

pub(super) async fn column_types(
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

/// Builds the `UPDATE ... SET ... WHERE ...` statement and its binds, without
/// running it — shared by `update_row_impl` (the plain-pool path) and
/// `update_pg_row`'s transaction branch, so the two can never drift apart.
async fn build_update(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
    set: &[ColumnValue],
    r#where: &[ColumnValue],
) -> Result<(String, Vec<Option<String>>), AppError> {
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
    Ok((sql, binds))
}

/// Runs a write statement (from `build_update`/`build_delete`) against anything
/// that can execute one — the plain pool (auto-commit) or a tab's held
/// transaction (`PgTransactions::execute`), which is exactly why this takes a
/// generic executor rather than a concrete `&PgPool`.
pub(super) async fn execute_write<'e, E>(sql: String, binds: Vec<Option<String>>, exec: E) -> Result<u64, AppError>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
    for bind in binds {
        query = query.bind(bind);
    }
    match query.execute(exec).await {
        Ok(result) => Ok(result.rows_affected()),
        Err(e) => Err(AppError::Postgres(e)),
    }
}

pub(crate) async fn update_row_impl(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
    set: &[ColumnValue],
    r#where: &[ColumnValue],
) -> Result<u64, AppError> {
    let (sql, binds) = build_update(pool, schema, table, set, r#where).await?;
    execute_write(sql, binds, pool).await
}

/// The history entry an update would record, from the column values the frontend
/// already had loaded (`before`) and what it set them to — never a server round
/// trip to re-SELECT a pre-image. Not yet actually recorded: the caller decides
/// when (immediately for auto-commit, only on commit for a held transaction).
fn history_entry(conn_id: &str, database: &str, schema: &str, table: &str, set: &[ColumnValue], before: &[ColumnValue], r#where: &[ColumnValue]) -> crate::pg_row_history::PgHistoryEntry {
    let changes = set
        .iter()
        .map(|after| {
            let prior = before.iter().find(|b| b.column == after.column);
            crate::pg_row_history::PgColumnChange {
                column: after.column.clone(),
                before: prior.map(|b| b.value.clone()).unwrap_or(serde_json::Value::Null),
                after: after.value.clone(),
            }
        })
        .collect();
    crate::pg_row_history::PgHistoryEntry {
        id: uuid::Uuid::new_v4().to_string(),
        conn_id: conn_id.to_string(),
        database: database.to_string(),
        schema: schema.to_string(),
        table: table.to_string(),
        at: chrono::Utc::now().timestamp_millis(),
        key: r#where.to_vec(),
        changes,
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
///
/// `before` carries `set`'s columns' pre-edit values — the grid already has them
/// loaded — so a successful edit can record a history entry (ozendb-h4y) without
/// an extra SELECT. `database` names which database this row's table lives in,
/// for that entry; scoped to the connection's own for now, not ozendb-bj2's
/// cross-database browsing (table edits don't support that yet).
///
/// A `tx_id` runs the update inside that held transaction instead of
/// auto-commit (see transaction.rs) — the same branch `run_pg_query` takes, so
/// Rollback undoes a cell edit the way it undoes a query. The transaction branch
/// queues its history entry rather than recording it now — see `PgTransactions::
/// execute` — so an edit later rolled back is never recorded as having happened.
/// Read-only is enforced either way: `pg_pool_for_write` refuses outright with no
/// `tx_id`, and a transaction begun on a read-only connection is already `SET
/// TRANSACTION READ ONLY` (see `begin_pg_transaction`), so Postgres itself
/// refuses the write.
#[tauri::command]
pub async fn update_pg_row(
    ctx: State<'_, AppContext>,
    txs: State<'_, super::PgTransactions>,
    history: State<'_, crate::pg_row_history::PgRowHistoryStore>,
    id: String,
    database: String,
    schema: String,
    table: String,
    set: Vec<ColumnValue>,
    before: Vec<ColumnValue>,
    r#where: Vec<ColumnValue>,
    tx_id: Option<String>,
) -> Result<u64, AppError> {
    let entry = history_entry(&id, &database, &schema, &table, &set, &before, &r#where);
    match tx_id {
        Some(tx_id) => {
            let pool = ctx.pg_pool(&id).await?;
            let (sql, binds) = build_update(&pool, &schema, &table, &set, &r#where).await?;
            txs.execute(&tx_id, sql, binds, Some(entry)).await
        }
        None => {
            let pool = ctx.pg_pool_for_write(&id).await?;
            let affected = update_row_impl(&pool, &schema, &table, &set, &r#where).await?;
            if affected > 0 {
                let _ = history.push(entry);
            }
            Ok(affected)
        }
    }
}

/// Builds the batched `DELETE ... WHERE (pk...) IN ((...), (...), ...)`
/// statement and its binds, without running it — the same build/execute split
/// `build_update` uses, for the same reason (the transaction branch below).
/// Every row must name its full primary key, the same guard `build_update`
/// applies — checked here per row since a batch shares one statement.
async fn build_delete(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
    rows: &[Vec<ColumnValue>],
) -> Result<(String, Vec<Option<String>>), AppError> {
    if rows.is_empty() {
        return Err(AppError::Validation("Nothing to delete.".to_string()));
    }

    let pk = primary_key_columns(pool, schema, table).await?;
    if pk.is_empty() {
        return Err(AppError::Validation(
            "This table has no primary key, so its rows can't be safely deleted.".to_string(),
        ));
    }
    // A BTreeSet iterates sorted — the same, deterministic column order names
    // every row's tuple below.
    let key_columns: Vec<&String> = pk.iter().collect();

    let types = column_types(pool, schema, table).await?;
    let qualified = format!("{}.{}", quote_ident(schema)?, quote_ident(table)?);

    let mut tuples = Vec::with_capacity(rows.len());
    let mut binds: Vec<Option<String>> = Vec::new();
    let mut param = 0;
    for row in rows {
        let mut placeholders = Vec::with_capacity(key_columns.len());
        for column in &key_columns {
            let value = match row.iter().find(|item| &item.column == *column) {
                Some(item) => &item.value,
                None => {
                    return Err(AppError::Validation(
                        "Each row identifier must include every primary-key column.".to_string(),
                    ))
                }
            };
            let pg_type = column_cast(&types, column)?;
            param += 1;
            placeholders.push(format!("${param}::{pg_type}"));
            binds.push(stringify_param(value, pg_type));
        }
        tuples.push(format!("({})", placeholders.join(", ")));
    }

    let key_list = key_columns
        .iter()
        .map(|column| quote_ident(column))
        .collect::<Result<Vec<_>, _>>()?
        .join(", ");
    let sql = format!("DELETE FROM {qualified} WHERE ({key_list}) IN ({})", tuples.join(", "));

    Ok((sql, binds))
}

pub(crate) async fn delete_rows_impl(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
    rows: &[Vec<ColumnValue>],
) -> Result<u64, AppError> {
    let (sql, binds) = build_delete(pool, schema, table, rows).await?;
    execute_write(sql, binds, pool).await
}

/// Deletes a batch of rows, each identified the same way `update_pg_row`'s
/// `where` is: its primary-key column(s) and their original values. One
/// statement for the whole batch. Returns the number of rows actually deleted —
/// fewer than `rows.len()` means some had already changed or gone (edited or
/// deleted since they were fetched), which the caller should report as a
/// conflict, not swallow. Same `tx_id`/read-only handling as `update_pg_row`.
#[tauri::command]
pub async fn delete_pg_rows(
    ctx: State<'_, AppContext>,
    txs: State<'_, super::PgTransactions>,
    id: String,
    schema: String,
    table: String,
    rows: Vec<Vec<ColumnValue>>,
    tx_id: Option<String>,
) -> Result<u64, AppError> {
    match tx_id {
        Some(tx_id) => {
            let pool = ctx.pg_pool(&id).await?;
            let (sql, binds) = build_delete(&pool, &schema, &table, &rows).await?;
            txs.execute(&tx_id, sql, binds, None).await
        }
        None => {
            let pool = ctx.pg_pool_for_write(&id).await?;
            delete_rows_impl(&pool, &schema, &table, &rows).await
        }
    }
}

/// Builds the `INSERT INTO ... (cols) VALUES (...)` statement and its binds, without
/// running it — the same build/execute split `build_update`/`build_delete` use, for
/// the same reason (the transaction branch below).
async fn build_insert(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
    values: &[ColumnValue],
) -> Result<(String, Vec<Option<String>>), AppError> {
    if values.is_empty() {
        return Err(AppError::Validation("Nothing to insert.".to_string()));
    }

    let types = column_types(pool, schema, table).await?;
    let qualified = format!("{}.{}", quote_ident(schema)?, quote_ident(table)?);

    let mut columns = Vec::with_capacity(values.len());
    let mut placeholders = Vec::with_capacity(values.len());
    let mut binds: Vec<Option<String>> = Vec::new();
    for (i, item) in values.iter().enumerate() {
        let pg_type = column_cast(&types, &item.column)?;
        columns.push(quote_ident(&item.column)?);
        placeholders.push(format!("${}::{pg_type}", i + 1));
        binds.push(stringify_param(&item.value, pg_type));
    }

    let sql = format!(
        "INSERT INTO {qualified} ({}) VALUES ({})",
        columns.join(", "),
        placeholders.join(", "),
    );

    Ok((sql, binds))
}

pub(crate) async fn insert_row_impl(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
    values: &[ColumnValue],
) -> Result<u64, AppError> {
    let (sql, binds) = build_insert(pool, schema, table, values).await?;
    execute_write(sql, binds, pool).await
}

/// Inserts one row from the column/value pairs in `values` — typically every
/// NOT-NULL column without a default, plus whatever optional ones the caller filled
/// in. An identity-always or stored-generated column (see `list_pg_columns`'s
/// `identity`/`generated`) must never appear here, or Postgres refuses it (428C9 for
/// identity; a generated column can't be targeted at all).
///
/// Returns 1 on success rather than decoding a `RETURNING` clause: the caller
/// refreshes its page after a save either way (an insert is one of possibly several
/// staged changes committed together), which reads the row back through the same
/// safe, already-typed browse path everything else in the grid uses — simpler than a
/// second, insert-specific JSON decode with its own numeric-precision handling to get
/// right (see `wrap_for_json`'s `text_cast` in query.rs for why that's not free).
///
/// Same `tx_id`/read-only handling as `update_pg_row`/`delete_pg_rows`.
#[tauri::command]
pub async fn insert_pg_row(
    ctx: State<'_, AppContext>,
    txs: State<'_, super::PgTransactions>,
    id: String,
    schema: String,
    table: String,
    values: Vec<ColumnValue>,
    tx_id: Option<String>,
) -> Result<u64, AppError> {
    match tx_id {
        Some(tx_id) => {
            let pool = ctx.pg_pool(&id).await?;
            let (sql, binds) = build_insert(&pool, &schema, &table, &values).await?;
            txs.execute(&tx_id, sql, binds, None).await
        }
        None => {
            let pool = ctx.pg_pool_for_write(&id).await?;
            insert_row_impl(&pool, &schema, &table, &values).await
        }
    }
}

#[cfg(test)]
#[path = "row_write.test.rs"]
mod tests;
