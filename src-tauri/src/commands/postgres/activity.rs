use crate::error::AppError;
use serde::Serialize;
use tauri::State;

use super::AppContext;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgSession {
    pub pid: i32,
    pub user: Option<String>,
    pub database: Option<String>,
    pub application: Option<String>,
    /// The client's address as text; None for a connection over a Unix socket.
    pub client: Option<String>,
    /// "active", "idle", "idle in transaction"… None for a background worker.
    pub state: Option<String>,
    /// The statement, as far as this role may see it. Postgres redacts other users'
    /// queries to `<insufficient privilege>` unless the viewer is superuser or holds
    /// pg_read_all_stats, so this reports what it was told, and `redacted` says which.
    pub query: Option<String>,
    pub redacted: bool,
    pub query_start: Option<String>,
    pub backend_start: Option<String>,
    pub wait_event_type: Option<String>,
    pub wait_event: Option<String>,
    /// This connection's own session, which the UI marks rather than offers to kill.
    pub is_self: bool,
}

// What Postgres puts in `query` when the viewing role may not read it.
const REDACTED: &str = "<insufficient privilege>";

pub(crate) async fn list_sessions_impl(pool: &sqlx::PgPool) -> Result<Vec<PgSession>, AppError> {
    let rows: Vec<(i32, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, bool)> =
        match sqlx::query_as(
            "SELECT pid, usename, datname, application_name, client_addr::text, state, query, \
                    query_start::text, backend_start::text, wait_event_type, wait_event, \
                    pid = pg_backend_pid() \
             FROM pg_stat_activity \
             ORDER BY (state = 'active') DESC, query_start DESC NULLS LAST, pid",
        )
        .fetch_all(pool)
        .await
        {
            Ok(val) => val,
            Err(e) => return Err(AppError::Postgres(e)),
        };
    Ok(rows
        .into_iter()
        .map(|(pid, user, database, application, client, state, query, query_start, backend_start, wait_event_type, wait_event, is_self)| {
            let redacted = query.as_deref() == Some(REDACTED);
            PgSession {
                pid,
                user,
                database,
                // An empty application_name is what a client that set none reports;
                // None reads better than an empty cell downstream.
                application: application.filter(|s| !s.is_empty()),
                client,
                state,
                // A redacted query is reported as absent plus the flag, so no caller
                // has to know Postgres's placeholder string to render it sensibly.
                query: if redacted { None } else { query.filter(|s| !s.is_empty()) },
                redacted,
                query_start,
                backend_start,
                wait_event_type,
                wait_event,
                is_self,
            }
        })
        .collect())
}

/// Ask a backend to stop its current statement. Graceful — the session survives, which
/// is what MongoDB's `kill_op` does, so it is the default offered.
pub(crate) async fn cancel_backend_impl(pool: &sqlx::PgPool, pid: i32) -> Result<bool, AppError> {
    signal(pool, "SELECT pg_cancel_backend($1)", pid).await
}

/// Close the whole session. Harsher: anything it was doing is rolled back and the
/// client is disconnected, so the UI confirms before calling this.
pub(crate) async fn terminate_backend_impl(pool: &sqlx::PgPool, pid: i32) -> Result<bool, AppError> {
    signal(pool, "SELECT pg_terminate_backend($1)", pid).await
}

// Both signals answer the same way: true when it was sent, false when the role may not
// signal that backend or the pid is already gone. Postgres returns false rather than
// raising for a pid that has exited, so a stale row is not an error.
async fn signal(pool: &sqlx::PgPool, sql: &'static str, pid: i32) -> Result<bool, AppError> {
    match sqlx::query_scalar::<_, bool>(sql).bind(pid).fetch_one(pool).await {
        Ok(val) => Ok(val),
        Err(e) => Err(AppError::Postgres(e)),
    }
}

/// Every session on the server, not just the ones this app opened.
#[tauri::command]
pub async fn pg_sessions(ctx: State<'_, AppContext>, id: String) -> Result<Vec<PgSession>, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    list_sessions_impl(&pool).await
}

/// Cancel one backend's running statement. This reads the server's activity and asks
/// it to stop something; it writes no data, so it is allowed on a read-only
/// connection — a read-only connection is about not changing rows, and a runaway
/// query started elsewhere is exactly what someone watching this tab needs to stop.
#[tauri::command]
pub async fn pg_cancel_backend(ctx: State<'_, AppContext>, id: String, pid: i32) -> Result<bool, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    cancel_backend_impl(&pool, pid).await
}

/// Terminate one backend's whole session.
#[tauri::command]
pub async fn pg_terminate_backend(ctx: State<'_, AppContext>, id: String, pid: i32) -> Result<bool, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    terminate_backend_impl(&pool, pid).await
}
