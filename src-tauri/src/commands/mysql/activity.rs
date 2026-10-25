//! The server's connections, as SHOW FULL PROCESSLIST lists them, and stopping one: its
//! statement (`KILL QUERY`) or the whole connection (`KILL CONNECTION`), the MySQL
//! siblings of PostgreSQL's cancel and terminate.
use crate::error::{mysql_number, AppError};
use serde::Serialize;
use sqlx::{MySqlPool, Row};
use tauri::State;

use super::AppContext;

/// MySQL's answers to a KILL of a connection that has gone, and of another login's.
const UNKNOWN_THREAD: u16 = 1094;
const NOT_OWNER: u16 = 1095;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MySqlProcess {
    pub id: i64,
    pub user: String,
    /// The client's `host:port`; None when MySQL gives none, as for its own threads.
    pub host: Option<String>,
    pub database: Option<String>,
    /// "Query", "Execute", "Sleep", "Daemon", "Killed"…
    pub command: String,
    /// Waiting for work rather than doing it: a sleeping client, or one of MySQL's own
    /// daemons, such as the event scheduler.
    pub idle: bool,
    /// How long it has been in its current state, in seconds.
    pub seconds: Option<i64>,
    pub state: Option<String>,
    pub query: Option<String>,
    /// The connection this list was read on, which the UI marks rather than offers to kill.
    pub is_self: bool,
}

/// Without the PROCESS privilege MySQL lists only the login's own connections, and says
/// nothing about the rest, so the frontend tells the reader so.
pub(crate) async fn mysql_processes(pool: &MySqlPool) -> Result<Vec<MySqlProcess>, AppError> {
    // One connection for both, so the id it reports for itself is one the list holds.
    let mut connection = pool.acquire().await.map_err(AppError::MySql)?;
    let own: i64 = sqlx::query_scalar("SELECT CAST(CONNECTION_ID() AS SIGNED)").fetch_one(&mut *connection).await.map_err(AppError::MySql)?;
    let rows = sqlx::query("SHOW FULL PROCESSLIST").fetch_all(&mut *connection).await.map_err(AppError::MySql)?;
    let mut processes = rows
        .iter()
        .map(|row| {
            let id: i64 = row.try_get("Id")?;
            let text = |column| row.try_get::<Option<String>, _>(column).map(|value| value.filter(|s| !s.is_empty()));
            let command: String = row.try_get("Command")?;
            Ok(MySqlProcess {
                id,
                user: row.try_get("User")?,
                host: text("Host")?,
                database: text("db")?,
                idle: matches!(command.as_str(), "Sleep" | "Daemon"),
                command,
                seconds: row.try_get("Time")?,
                state: text("State")?,
                query: text("Info")?,
                is_self: id == own,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(AppError::MySql)?;
    // Working connections first, longest-running at the top, then the idle ones.
    processes.sort_by_key(|p| (p.idle, std::cmp::Reverse(p.seconds), p.id));
    Ok(processes)
}

/// Stop a connection's current statement; the connection stays open. False when it has
/// already gone.
pub(crate) async fn mysql_kill_query(pool: &MySqlPool, process: i64) -> Result<bool, AppError> {
    kill(pool, "KILL QUERY", process).await
}

/// Close a connection, rolling back whatever transaction it holds, so the UI confirms
/// first.
pub(crate) async fn mysql_kill_connection(pool: &MySqlPool, process: i64) -> Result<bool, AppError> {
    kill(pool, "KILL CONNECTION", process).await
}

async fn kill(pool: &MySqlPool, statement: &str, process: i64) -> Result<bool, AppError> {
    match sqlx::raw_sql(sqlx::AssertSqlSafe(format!("{statement} {process}"))).execute(pool).await {
        Ok(_) => Ok(true),
        Err(e) => match mysql_number(&e) {
            Some(UNKNOWN_THREAD) => Ok(false),
            // SUPER grants it too, but is deprecated.
            Some(NOT_OWNER) => Err(AppError::Forbidden(format!(
                "MySQL lets this login stop only its own connections: stopping connection {process} needs CONNECTION_ADMIN."
            ))),
            _ => Err(AppError::MySql(e)),
        },
    }
}

/// Every connection on the server this login may see.
#[tauri::command]
pub async fn list_mysql_processes(ctx: State<'_, AppContext>, id: String) -> Result<Vec<MySqlProcess>, AppError> {
    mysql_processes(&ctx.mysql_pool(&id, None).await?).await
}

/// Stopping a statement writes no data, so a read-only connection may, as on PostgreSQL:
/// a runaway query started elsewhere is what someone watching this list needs to stop.
#[tauri::command]
pub async fn kill_mysql_query(ctx: State<'_, AppContext>, id: String, process: i64) -> Result<bool, AppError> {
    mysql_kill_query(&ctx.mysql_pool(&id, None).await?, process).await
}

#[tauri::command]
pub async fn kill_mysql_connection(ctx: State<'_, AppContext>, id: String, process: i64) -> Result<bool, AppError> {
    mysql_kill_connection(&ctx.mysql_pool(&id, None).await?, process).await
}
