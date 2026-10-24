//! Stopping a running SQL query. While one runs, its server process id is kept under
//! the run id the frontend chose for it; Cancel asks the server to stop that process,
//! and marks the run cancelled for a statement that hadn't started yet to find.
use crate::error::AppError;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::State;

use super::AppContext;

fn running() -> &'static Mutex<HashMap<String, (i32, Arc<AtomicBool>)>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, (i32, Arc<AtomicBool>)>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Keeps a run registered for as long as it's alive — however the query ends.
pub(super) struct RunGuard(String, Arc<AtomicBool>);

impl RunGuard {
    /// An error if the run was cancelled: a cancel that comes between statements finds
    /// the process idle, and stops nothing on the server.
    pub(super) fn stopped(&self) -> Result<(), AppError> {
        if self.1.load(Ordering::SeqCst) {
            return Err(AppError::Cancelled);
        }
        Ok(())
    }
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        if let Ok(mut map) = running().lock() {
            map.remove(&self.0);
        }
    }
}

/// Registers the query about to run on `conn` under `run_id`.
pub(super) async fn register(conn: &mut sqlx::PgConnection, run_id: &str) -> Result<RunGuard, AppError> {
    let pid: i32 = match sqlx::query_scalar("SELECT pg_backend_pid()").fetch_one(&mut *conn).await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    let cancelled = Arc::new(AtomicBool::new(false));
    if let Ok(mut map) = running().lock() {
        map.insert(run_id.to_string(), (pid, cancelled.clone()));
    }
    Ok(RunGuard(run_id.to_string(), cancelled))
}

/// Cancels the query running under `run_id`; false when none is (it already finished).
pub(crate) async fn cancel_query_impl(pool: &sqlx::PgPool, run_id: &str) -> Result<bool, AppError> {
    let found = running().lock().ok().and_then(|map| map.get(run_id).cloned());
    let Some((pid, cancelled)) = found else { return Ok(false) };
    cancelled.store(true, Ordering::SeqCst);
    match sqlx::query_scalar::<_, bool>("SELECT pg_cancel_backend($1)").bind(pid).fetch_one(pool).await {
        Ok(val) => Ok(val),
        Err(e) => Err(AppError::Postgres(e)),
    }
}

#[tauri::command]
pub async fn cancel_pg_query(ctx: State<'_, AppContext>, id: String, run_id: String) -> Result<bool, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    cancel_query_impl(&pool, &run_id).await
}
