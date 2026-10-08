use crate::error::AppError;
use serde::Serialize;
use sqlx::{Column, Executor, SqlSafeStr, Statement};
use tauri::State;

use super::{cancel, AppContext};

/// Cap on rows returned by an arbitrary or browse query — the Postgres sibling of
/// `AGG_RESULT_CAP` for Mongo's `run_aggregate`. Requested as `<cap>+1` so
/// truncation is detectable without a second `COUNT(*)` round trip.
pub(super) const ROW_RESULT_CAP: i64 = 10_000;

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
    /// Set for a statement that returns no rows (INSERT, UPDATE, DDL…): how many rows it changed.
    pub rows_affected: Option<u64>,
}

/// Column names and the `json_build_array(...)` wrapper SQL, built from a
/// prepared statement's own reported columns — never from the wrapped query or
/// the decoded rows: `to_json` renders a row as a JSON *object*, whose keys
/// silently collapse when two columns share a name (a join on `id`) or have
/// none (`SELECT 1, 2`, both named `?column?`) — confirmed against a live
/// server, losing a real column each time. This works around it by aliasing
/// `inner_sql`'s columns positionally (`AS t(c0, c1, …)`, never by name) and
/// returning `json_build_array(...)`, an array, not an object, so position —
/// not a possibly-duplicate name — is what ties a decoded value back to the
/// returned column list.
///
/// `NUMERIC` columns — and numeric arrays and domains — are cast to text before `to_json`: Postgres
/// renders `numeric` with its full, arbitrary precision, but this crate's
/// `serde_json` is built without `arbitrary_precision`, so decoding that back as
/// a bare JSON number would silently round it to the nearest `f64` — including a
/// numeric primary key, which would then fail to match anything in
/// `update_pg_row`. Sent as a JSON string instead, the exact text survives.
///
/// Pure (no I/O) so it only needs `stmt`, already fetched by whichever executor
/// (`PgPool` or a transaction) the caller is using — see `run_wrapped`/
/// `run_wrapped_read_only` below.
/// The text type a column is cast to before `to_json`, if it would otherwise lose
/// digits: `numeric`, an array of it, or a domain over either (see `wrap_for_json`).
fn text_cast(type_info: &sqlx::postgres::PgTypeInfo) -> Option<&'static str> {
    use sqlx::postgres::PgTypeKind;
    match type_info.kind() {
        PgTypeKind::Domain(base) => text_cast(base),
        PgTypeKind::Array(element) => text_cast(element).map(|_| "text[]"),
        _ if type_info.to_string().eq_ignore_ascii_case("numeric") => Some("text"),
        _ => None,
    }
}

fn wrap_for_json(stmt: &sqlx::postgres::PgStatement, inner_sql: &str) -> (Vec<String>, String) {
    let columns: Vec<String> = stmt.columns().iter().map(|c| c.name().to_string()).collect();
    if columns.is_empty() {
        return (columns, String::new());
    }

    let exprs: Vec<String> = stmt
        .columns()
        .iter()
        .enumerate()
        .map(|(i, col)| {
            let alias = format!("c{i}");
            match text_cast(col.type_info()) {
                Some(cast) => format!("to_json((t.{alias})::{cast})"),
                None => format!("to_json(t.{alias})"),
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
    (columns, wrapped)
}

/// Turns the raw `json_build_array(...)` results into `PgQueryResult`'s
/// rows-of-values shape and applies the truncation cap. Pure, shared by both
/// `run_wrapped` and `run_wrapped_read_only`.
fn rows_from_json(mut raw_rows: Vec<serde_json::Value>) -> (Vec<Vec<serde_json::Value>>, bool) {
    let truncated = raw_rows.len() > ROW_RESULT_CAP as usize;
    if truncated {
        raw_rows.truncate(ROW_RESULT_CAP as usize);
    }
    // `json_build_array` always yields a JSON array; the fallback only guards
    // against that guarantee somehow not holding, rather than panicking.
    let rows = raw_rows
        .into_iter()
        .map(|row| match row {
            serde_json::Value::Array(values) => values,
            other => vec![other],
        })
        .collect();
    (rows, truncated)
}

/// Wraps `inner_sql` — one subquery-able SELECT/CTE/VALUES expression — so every
/// row comes back as a JSON array via Postgres's own `to_json` (see
/// `wrap_for_json`), sidestepping a per-Postgres-type Rust-side decoder
/// entirely: whatever the query returns, the server already knows how to render
/// as JSON. Only something a `FROM` clause can wrap returns rows this way; a statement
/// with no result columns (INSERT, UPDATE, DDL…) runs as it is instead.
///
/// Column names come from `Executor::prepare`, not `describe`: the latter is the
/// `query!` macros' offline plumbing, behind the unused `macros` feature.
///
/// Runs on one connection — the caller's plain one, or its read-only transaction.
/// `binds` fill `inner_sql`'s `$n` placeholders, in order; a `run_id` makes the run
/// cancellable (see cancel.rs) until it ends.
pub(super) async fn run_wrapped_on(
    conn: &mut sqlx::PgConnection,
    inner_sql: &str,
    binds: &[String],
    run_id: Option<&str>,
) -> Result<PgQueryResult, AppError> {
    let _running = match run_id {
        Some(id) => Some(cancel::register(&mut *conn, id).await?),
        None => None,
    };
    let stmt = (&mut *conn).prepare(sqlx::AssertSqlSafe(inner_sql.to_string()).into_sql_str()).await.map_err(AppError::Postgres)?;
    let (columns, wrapped) = wrap_for_json(&stmt, inner_sql);
    let started = std::time::Instant::now();
    // Nothing to wrap: a statement, run as it is.
    if columns.is_empty() {
        let mut query = sqlx::query(sqlx::AssertSqlSafe(inner_sql.to_string()));
        for bind in binds {
            query = query.bind(bind);
        }
        let done = query.execute(&mut *conn).await.map_err(AppError::Postgres)?;
        let elapsed_ms = started.elapsed().as_millis() as u64;
        return Ok(PgQueryResult { columns, rows: Vec::new(), truncated: false, elapsed_ms, rows_affected: Some(done.rows_affected()) });
    }
    let mut query = sqlx::query_scalar::<_, serde_json::Value>(sqlx::AssertSqlSafe(wrapped));
    for bind in binds {
        query = query.bind(bind);
    }
    let raw_rows: Vec<serde_json::Value> = match query.fetch_all(&mut *conn).await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    let elapsed_ms = started.elapsed().as_millis() as u64;
    let (rows, truncated) = rows_from_json(raw_rows);

    Ok(PgQueryResult { columns, rows, truncated, elapsed_ms, rows_affected: None })
}

/// `run_wrapped_on` a connection borrowed from the pool.
pub(super) async fn run_wrapped(pool: &sqlx::PgPool, inner_sql: &str, binds: &[String], run_id: Option<&str>) -> Result<PgQueryResult, AppError> {
    let mut conn = pool.acquire().await.map_err(AppError::Postgres)?;
    run_wrapped_on(&mut conn, inner_sql, binds, run_id).await
}

/// The `read_only`-enforced sibling of `run_wrapped`, for `run_pg_query` alone:
/// runs `inner_sql` inside its own transaction that starts with `SET TRANSACTION
/// READ ONLY`, then always rolls back (this path never writes, so there is
/// nothing to commit). This is the real enforcement for arbitrary caller SQL —
/// `postgres::uri::options_for`'s `default_transaction_read_only` session default is
/// only a *default*: a query can flip it off for the rest of the session with
/// `set_config('default_transaction_read_only', 'off', false)` (confirmed live),
/// but can't do the same to a transaction that already explicitly set itself
/// read-only, and every call here starts a fresh one.
async fn run_wrapped_read_only(pool: &sqlx::PgPool, inner_sql: &str, run_id: Option<&str>) -> Result<PgQueryResult, AppError> {
    let mut tx = match pool.begin().await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    let result = match sqlx::query("SET TRANSACTION READ ONLY").execute(&mut *tx).await {
        Ok(_) => run_wrapped_on(&mut tx, inner_sql, &[], run_id).await,
        Err(e) => Err(AppError::Postgres(e)),
    };
    let _ = tx.rollback().await;
    result
}

/// Runs caller SQL (see `run_pg_query`) — cancellable under `run_id` while it runs.
pub(crate) async fn run_query_as(pool: &sqlx::PgPool, sql: &str, read_only: bool, run_id: Option<&str>) -> Result<PgQueryResult, AppError> {
    let trimmed = super::statement::caller_sql(sql)?;
    if read_only {
        return run_wrapped_read_only(pool, trimmed, run_id).await;
    }
    run_wrapped(pool, trimmed, &[], run_id).await
}

/// Runs one statement from the SQL editor: a query returns its rows, anything else
/// (INSERT, UPDATE, DDL…) how many rows it changed. A statement that also returns rows
/// (`… RETURNING`) can't be wrapped and fails (see `run_wrapped`). Uses `pg_pool`, not `pg_pool_for_write`, so a `read_only`
/// connection can still query — constrained by `run_wrapped_read_only`. A `run_id`
/// lets `cancel_pg_query` stop it; a `tx_id` runs it in that held transaction instead
/// (see transaction.rs). `database`, when given, targets a database other than the
/// connection's own — opening a second database on the same server (#124).
#[tauri::command]
pub async fn run_pg_query(
    ctx: State<'_, AppContext>,
    id: String,
    sql: String,
    run_id: Option<String>,
    tx_id: Option<String>,
    database: Option<String>,
    txs: State<'_, super::PgTransactions>,
) -> Result<PgQueryResult, AppError> {
    if let Some(tx_id) = tx_id {
        return txs.run(&tx_id, &sql, run_id.as_deref()).await;
    }
    let pool = ctx.pg_pool_for_database(&id, database.as_deref()).await?;
    let read_only = ctx.is_read_only(&id);
    run_query_as(&pool, &sql, read_only, run_id.as_deref()).await
}

// `ColumnValue`, row-write SQL building (`update_pg_row`/`delete_pg_rows`) and
// the metadata reads they alone need (`column_types`) live in row_write.rs —
// split out once this file grew past the size limit. Arbitrary caller SQL
// (`run_pg_query` above) and one row's typed write share nothing but
// `AppContext`/`PgTransactions`.
