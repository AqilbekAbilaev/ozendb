//! The SQL tab's runs: a script's statements, one after another on one session, each
//! answering with its rows or how many rows it changed.
use std::time::Duration;

use futures_util::TryStreamExt;
use sqlparser::dialect::MySqlDialect;
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
use crate::error::{mysql_number, AppError};
use crate::mysql::session::{QUERY_TIME_LIMIT, READ_ONLY_LOCK};

/// What MySQL answers a statement it can't prepare with, such as USE or LOCK TABLES.
const NOT_PREPARABLE: u16 = 1295;

/// A deadlock, after which MySQL has rolled the statement's whole transaction back.
const DEADLOCK: u16 = 1213;

/// One statement, answering with its result, or a CALL with each result set its procedure
/// returns. It is prepared, so its cells arrive in the binary form cell.rs reads and a
/// query that returns no rows still names its columns. A CALL names them only in the rows
/// it returns, so a set with none can't be told from the CALL's own status and is left
/// out; a CALL that returns no rows answers with how many it changed. One that can't be
/// prepared runs as text and returns none. Past the row cap, a query on a session that is
/// `held` open is read to its end all the same: MySQL waits on a result nobody reads, and
/// gives up on its session after `net_write_timeout`, taking the transaction with it. One
/// that isn't held stops reading there, since its session closes after the run; a CALL is
/// read on, as its procedure may still be writing after a capped set.
async fn run_one(conn: &mut MySqlConnection, sql: &str, held: bool) -> Result<Vec<SqlQueryResult>, AppError> {
    let started = std::time::Instant::now();
    let elapsed_ms = || started.elapsed().as_millis() as u64;
    let prepared = match (&mut *conn).prepare(sqlx::AssertSqlSafe(sql.to_string()).into_sql_str()).await {
        Ok(prepared) => prepared,
        Err(e) if mysql_number(&e) == Some(NOT_PREPARABLE) => {
            let done = sqlx::raw_sql(sqlx::AssertSqlSafe(sql.to_string())).execute(&mut *conn).await.map_err(AppError::MySql)?;
            return Ok(vec![SqlQueryResult { columns: Vec::new(), rows: Vec::new(), truncated: false, elapsed_ms: elapsed_ms(), rows_affected: Some(done.rows_affected()) }]);
        }
        Err(e) => return Err(AppError::MySql(e)),
    };
    let columns: Vec<String> = prepared.columns().iter().map(|c| c.name().to_string()).collect();
    let read_to_the_end = held || columns.is_empty();
    let set = |columns| SqlQueryResult { columns, rows: Vec::new(), truncated: false, elapsed_ms: 0, rows_affected: None };
    let (mut results, mut current, mut affected) = (Vec::new(), set(columns), 0);
    let mut stream = (&mut *conn).fetch_many(sqlx::query(sqlx::AssertSqlSafe(sql.to_string())));
    while let Some(item) = stream.try_next().await.map_err(AppError::MySql)? {
        match item {
            Either::Left(done) => {
                affected += done.rows_affected();
                if !current.columns.is_empty() {
                    results.push(SqlQueryResult { elapsed_ms: elapsed_ms(), ..std::mem::replace(&mut current, set(Vec::new())) });
                }
            }
            Either::Right(_) if current.rows.len() as i64 == ROW_RESULT_CAP => {
                current.truncated = true;
                if !read_to_the_end {
                    break;
                }
            }
            Either::Right(row) => {
                if current.columns.is_empty() {
                    current.columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                }
                current.rows.push((0..row.len()).map(|i| row.try_get_raw(i).map(|value| cell(value, None))).collect::<Result<_, _>>().map_err(AppError::MySql)?);
            }
        }
    }
    if !current.columns.is_empty() {
        results.push(SqlQueryResult { elapsed_ms: elapsed_ms(), ..current });
    }
    if results.is_empty() {
        results.push(SqlQueryResult { elapsed_ms: elapsed_ms(), rows_affected: Some(affected), ..set(Vec::new()) });
    }
    Ok(results)
}

/// Runs `statements` in order on `conn` as `run`, stopping at the first that fails; each
/// answers with its own result, or a CALL with each of its result sets. Cancel can stop `run`, and no statement may run past
/// `limit`; either sends `KILL QUERY` from a session opened with `pool`'s options. On a
/// `read_only` connection the session is locked again before each statement, so nothing
/// an earlier one did can leave the next one free to write. That still leaves a stored
/// procedure that lifts the lock and writes within one CALL: only the server's own
/// privileges stop that. `held` is a session holding a Manual-mode transaction.
pub(super) async fn run_on(
    conn: &mut MySqlConnection,
    pool: &MySqlPool,
    run: &Run,
    statements: &[&str],
    limit: Duration,
    read_only: bool,
    held: bool,
) -> Result<Vec<SqlQueryResult>, AppError> {
    run.stopped()?;
    let connection = sqlx::query_scalar("SELECT CONNECTION_ID()").fetch_one(&mut *conn).await.map_err(AppError::MySql)?;
    run.on(connection, async {
        let mut results = Vec::with_capacity(statements.len());
        for (i, statement) in statements.iter().enumerate() {
            if read_only {
                sqlx::raw_sql(READ_ONLY_LOCK).execute(&mut *conn).await.map_err(AppError::MySql)?;
            }
            let outcome = run.limited(pool, limit, run_one(conn, statement, held)).await.map_err(|e| match e {
                AppError::MySql(e) if held && mysql_number(&e) == Some(DEADLOCK) => AppError::RolledBack(Box::new(AppError::MySql(e))),
                e => e,
            });
            match outcome {
                Ok(result) => results.extend(result),
                Err(e) if i == 0 => return Err(e),
                Err(e) => return Err(AppError::InScript { number: i + 1, source: Box::new(e) }),
            }
        }
        Ok(results)
    })
    .await
}

/// Runs caller SQL (see `run_mysql_query`) on a session of its own, closed afterwards:
/// whatever the SQL changed in it — a time zone, a lock, a read-only mode lifted on a
/// writable connection — ends with the run rather than reaching the next one.
pub(crate) async fn run_mysql_sql(pool: &MySqlPool, sql: &str, read_only: bool, run_id: Option<&str>, limit: Duration) -> Result<Vec<SqlQueryResult>, AppError> {
    let statements = statements(sql, read_only)?;
    let run = Run::new(run_id);
    // Cancel ends the wait for a session too: there's no session yet to send a KILL to.
    let mut conn = run.unless_stopped(async { pool.acquire().await.map_err(AppError::MySql) }).await?;
    conn.close_on_drop();
    run_on(&mut conn, pool, &run, &statements, limit, read_only, false).await
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

/// The SQL laid out one clause per line (see `format_sql`), in MySQL's dialect.
#[tauri::command(async)]
pub fn format_mysql_sql(sql: String) -> Result<String, AppError> {
    format_sql(&MySqlDialect {}, &sql).map_err(AppError::Sql)
}

#[cfg(test)]
#[path = "query.test.rs"]
mod tests;
