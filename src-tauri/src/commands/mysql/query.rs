//! The SQL tab's runs: a script's statements, one after another on one session, each
//! answering with its rows or how many rows it changed.
use std::time::Duration;

use futures_util::TryStreamExt;
use sqlparser::dialect::MySqlDialect;
use sqlparser::tokenizer::{Token, Tokenizer};
use sqlx::mysql::MySqlConnection;
use sqlx::{Column, Either, Executor, MySqlPool, Row, SqlSafeStr, Statement};
use tauri::State;

use super::cancel::Run;
use super::cell::cell;
use super::script::statements;
use super::transaction::MySqlTransactions;
use super::AppContext;
use crate::commands::sql::format::format_sql;
use crate::commands::sql::{SqlQueryResult, ROW_RESULT_CAP};
use crate::error::AppError;
use crate::mysql::session::QUERY_TIME_LIMIT;

/// What MySQL answers a statement it can't prepare with, such as USE or LOCK TABLES.
const NOT_PREPARABLE: u16 = 1295;

fn number(e: &sqlx::Error) -> Option<u16> {
    match e {
        sqlx::Error::Database(e) => e.try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>().map(|e| e.number()),
        _ => None,
    }
}

/// One statement. It is prepared, so its cells arrive in the binary form cell.rs reads
/// and a query that returns no rows still names its columns. A CALL names them only in
/// the rows it returns, and only its first result is kept. One that can't be prepared
/// runs as text and returns none.
async fn run_one(conn: &mut MySqlConnection, sql: &str) -> Result<SqlQueryResult, AppError> {
    let started = std::time::Instant::now();
    let elapsed_ms = || started.elapsed().as_millis() as u64;
    let prepared = match (&mut *conn).prepare(sqlx::AssertSqlSafe(sql.to_string()).into_sql_str()).await {
        Ok(prepared) => prepared,
        Err(e) if number(&e) == Some(NOT_PREPARABLE) => {
            let done = sqlx::raw_sql(sqlx::AssertSqlSafe(sql.to_string())).execute(&mut *conn).await.map_err(AppError::MySql)?;
            return Ok(SqlQueryResult { columns: Vec::new(), rows: Vec::new(), truncated: false, elapsed_ms: elapsed_ms(), rows_affected: Some(done.rows_affected()) });
        }
        Err(e) => return Err(AppError::MySql(e)),
    };
    let mut columns: Vec<String> = prepared.columns().iter().map(|c| c.name().to_string()).collect();
    let (mut rows, mut truncated, mut affected, mut first_done) = (Vec::new(), false, 0, false);
    let mut stream = (&mut *conn).fetch_many(sqlx::query(sqlx::AssertSqlSafe(sql.to_string())));
    while let Some(item) = stream.try_next().await.map_err(AppError::MySql)? {
        match item {
            Either::Left(done) => {
                affected += done.rows_affected();
                first_done |= !columns.is_empty();
            }
            Either::Right(_) if first_done => {}
            Either::Right(_) if rows.len() as i64 == ROW_RESULT_CAP => truncated = true,
            Either::Right(row) => {
                if columns.is_empty() {
                    columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                }
                rows.push((0..row.len()).map(|i| row.try_get_raw(i).map(|value| cell(value, None))).collect::<Result<_, _>>().map_err(AppError::MySql)?);
            }
        }
    }
    let rows_affected = columns.is_empty().then_some(affected);
    Ok(SqlQueryResult { columns, rows, truncated, elapsed_ms: elapsed_ms(), rows_affected })
}

/// Runs `statements` in order on `conn`, stopping at the first that fails; each answers
/// with its own result. A `run_id` lets Cancel stop it, and no statement may run past
/// `limit`; either sends `KILL QUERY` through `pool`, from another session.
pub(super) async fn run_on(
    conn: &mut MySqlConnection,
    pool: &MySqlPool,
    statements: &[&str],
    run_id: Option<&str>,
    limit: Duration,
) -> Result<Vec<SqlQueryResult>, AppError> {
    let connection: u64 = sqlx::query_scalar("SELECT CONNECTION_ID()").fetch_one(&mut *conn).await.map_err(AppError::MySql)?;
    let run = Run::new(run_id, connection);
    let mut results = Vec::with_capacity(statements.len());
    for (i, statement) in statements.iter().enumerate() {
        match run.limited(pool, limit, run_one(conn, statement)).await {
            Ok(result) => results.push(result),
            Err(e) if i == 0 => return Err(e),
            Err(e) => return Err(AppError::InScript { number: i + 1, source: Box::new(e) }),
        }
    }
    Ok(results)
}

/// Runs caller SQL (see `run_mysql_query`) on a session of its own, closed afterwards:
/// whatever the SQL changed in it — a time zone, a lock, a read-only mode lifted on a
/// writable connection — ends with the run rather than reaching the next one.
pub(crate) async fn run_mysql_sql(pool: &MySqlPool, sql: &str, read_only: bool, run_id: Option<&str>, limit: Duration) -> Result<Vec<SqlQueryResult>, AppError> {
    let statements = statements(sql, read_only)?;
    let mut conn = pool.acquire().await.map_err(AppError::MySql)?;
    conn.close_on_drop();
    run_on(&mut conn, pool, &statements, run_id, limit).await
}

/// Runs the SQL tab's script, one statement after another, answering with each one's
/// result. `run_id` lets `cancel_mysql_query` stop it; `tx_id` runs it in that held
/// transaction instead (see transaction.rs). `database`, when given, is the one the
/// session starts in rather than the connection's own. Read through `mysql_pool`, not
/// the write-gated one, so a read-only connection can still query: its sessions are
/// read-only on the server (`mysql::session`).
#[tauri::command]
pub async fn run_mysql_query(
    ctx: State<'_, AppContext>,
    txs: State<'_, MySqlTransactions>,
    id: String,
    sql: String,
    run_id: Option<String>,
    tx_id: Option<String>,
    database: Option<String>,
) -> Result<Vec<SqlQueryResult>, AppError> {
    let pool = ctx.mysql_pool(&id, database.as_deref()).await?;
    let read_only = ctx.is_read_only(&id);
    match tx_id {
        Some(tx_id) => txs.run(&tx_id, &pool, &sql, read_only, run_id.as_deref()).await,
        None => run_mysql_sql(&pool, &sql, read_only, run_id.as_deref(), QUERY_TIME_LIMIT).await,
    }
}

/// The SQL laid out one clause per line (see `format_sql`). A string holding a backslash
/// is refused: sqlparser writes it back bare, which MySQL reads as an escape, so
/// `'a\\b'` would come back as `'a\b'`, a different string.
// A sqlparser bug, not yet reported upstream: a string's Display doesn't escape
// backslashes for a dialect whose strings take them.
#[tauri::command(async)]
pub fn format_mysql_sql(sql: String) -> Result<String, AppError> {
    let dialect = MySqlDialect {};
    let tokens = Tokenizer::new(&dialect, &sql).tokenize().map_err(|e| AppError::Sql(e.to_string()))?;
    if tokens.iter().any(|t| matches!(t, Token::SingleQuotedString(text) | Token::DoubleQuotedString(text) if text.contains('\\'))) {
        return Err(AppError::Sql(String::from("SQL with a backslash in a string isn't formatted, since formatting would change the string.")));
    }
    format_sql(&dialect, &sql).map_err(AppError::Sql)
}

#[cfg(test)]
#[path = "query.test.rs"]
mod tests;
