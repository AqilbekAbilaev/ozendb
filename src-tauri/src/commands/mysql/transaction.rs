//! The SQL tab's Manual-mode transactions, each held open on a session of its own under
//! an id the tab chose, until committed or rolled back. The session runs with autocommit
//! off, so whatever ends a transaction early (a statement that commits by itself, such as
//! DDL, or a deadlock rolling it back) only starts the next one: every statement stays in
//! a transaction until Commit or Rollback. MySQL keeps a transaction going after a failed
//! statement, so a commit keeps what did run, as it would in any client.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use sqlx::pool::PoolConnection;
use sqlx::{MySql, MySqlPool};
use tauri::State;

use super::query::run_on;
use super::script::statements;
use super::AppContext;
use crate::commands::sql::SqlQueryResult;
use crate::error::AppError;
use crate::mysql::session::QUERY_TIME_LIMIT;

type Held = Arc<tokio::sync::Mutex<PoolConnection<MySql>>>;

/// Dropping one (the app closing) closes its session, which rolls the transaction back.
#[derive(Default)]
pub struct MySqlTransactions {
    open: Mutex<HashMap<String, Held>>,
}

fn ended() -> AppError {
    AppError::Validation(String::from("That transaction has already ended."))
}

async fn execute(conn: &mut PoolConnection<MySql>, sql: &'static str) -> Result<(), AppError> {
    sqlx::raw_sql(sql).execute(&mut **conn).await.map(drop).map_err(AppError::MySql)
}

impl MySqlTransactions {
    /// A read-only connection holds read-only transactions: its session is locked, so each
    /// one autocommit-off starts is read-only. The session is closed once the transaction
    /// ends, as an auto-commit run's is (see `run_mysql_sql`); closing it with autocommit
    /// off rolls back whatever wasn't committed.
    pub async fn begin(&self, pool: &MySqlPool, tx_id: &str, read_only: bool) -> Result<(), AppError> {
        let mut conn = pool.acquire().await.map_err(AppError::MySql)?;
        conn.close_on_drop();
        execute(&mut conn, if read_only { "SET autocommit = 0, SESSION transaction_read_only = ON" } else { "SET autocommit = 0" }).await?;
        self.open.lock().unwrap().insert(tx_id.to_string(), Arc::new(tokio::sync::Mutex::new(conn)));
        Ok(())
    }

    fn held(&self, tx_id: &str) -> Result<Held, AppError> {
        self.open.lock().unwrap().get(tx_id).cloned().ok_or_else(ended)
    }

    /// `pool` is the one Cancel and the time limit stop a statement through.
    pub async fn run(&self, tx_id: &str, pool: &MySqlPool, sql: &str, read_only: bool, run_id: Option<&str>) -> Result<Vec<SqlQueryResult>, AppError> {
        let statements = statements(sql, read_only)?;
        let held = self.held(tx_id)?;
        let mut conn = held.lock().await;
        run_on(&mut conn, pool, &statements, run_id, QUERY_TIME_LIMIT, read_only, true).await
    }

    pub async fn finish(&self, tx_id: &str, commit: bool) -> Result<(), AppError> {
        let held = self.open.lock().unwrap().remove(tx_id).ok_or_else(ended)?;
        let mut conn = held.lock().await;
        execute(&mut conn, if commit { "COMMIT" } else { "ROLLBACK" }).await
    }
}

/// `database`, when given, is the one the session starts in rather than the connection's own.
#[tauri::command]
pub async fn begin_mysql_transaction(
    ctx: State<'_, AppContext>,
    txs: State<'_, MySqlTransactions>,
    id: String,
    tx_id: String,
    database: Option<String>,
) -> Result<(), AppError> {
    let pool = ctx.mysql_pool(&id, database.as_deref()).await?;
    txs.begin(&pool, &tx_id, ctx.is_read_only(&id)).await
}

#[tauri::command]
pub async fn commit_mysql_transaction(txs: State<'_, MySqlTransactions>, tx_id: String) -> Result<(), AppError> {
    txs.finish(&tx_id, true).await
}

#[tauri::command]
pub async fn rollback_mysql_transaction(txs: State<'_, MySqlTransactions>, tx_id: String) -> Result<(), AppError> {
    txs.finish(&tx_id, false).await
}
