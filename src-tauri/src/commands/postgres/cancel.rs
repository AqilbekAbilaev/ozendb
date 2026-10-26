//! Stopping a running SQL query. While one runs, its server process id is kept under
//! the run id the frontend chose for it; Cancel marks the run cancelled, so a statement
//! that hasn't started yet doesn't start, and asks the server to stop the one running.
use crate::error::AppError;
use std::collections::HashMap;
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::State;

use super::AppContext;

/// How long Cancel waits before signalling a statement that is still running again.
const RESIGNAL_AFTER: Duration = Duration::from_millis(100);
/// How long Cancel keeps signalling. A signal is lost only when it beats the statement
/// to the server, so a statement still running past this ignores them: it may be waiting
/// on something a cancel can't stop, or run on another process than the one signalled,
/// as behind a connection pooler, where each signal stops some other client's query.
const RESIGNAL_FOR: Duration = Duration::from_secs(2);

fn running() -> &'static Mutex<HashMap<String, Arc<Run>>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, Arc<Run>>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// One run: the server process it runs on, whether it was cancelled, and whether a
/// statement of its is running there now.
pub(super) struct Run {
    id: String,
    pid: i32,
    cancelled: AtomicBool,
    // Set once the run is over, even when it never got to note its statement ended, as
    // when it was dropped or panicked mid-statement: its connection may serve another
    // run by then.
    ended: AtomicBool,
    // Held by Cancel while it signals the process, so the statement can't end, and the
    // connection pass to the next run, whose query the signal would stop instead.
    in_statement: tokio::sync::Mutex<bool>,
}

impl Run {
    fn new(id: &str, pid: i32) -> Run {
        Run { id: id.to_string(), pid, cancelled: AtomicBool::new(false), ended: AtomicBool::new(false), in_statement: tokio::sync::Mutex::new(false) }
    }

    /// `statement`'s outcome, unless the run was cancelled before it started.
    pub(super) async fn on<T>(&self, statement: impl Future<Output = Result<T, AppError>>) -> Result<T, AppError> {
        {
            let mut in_statement = self.in_statement.lock().await;
            if self.cancelled.load(Ordering::SeqCst) {
                return Err(AppError::Cancelled);
            }
            *in_statement = true;
        }
        let outcome = statement.await;
        *self.in_statement.lock().await = false;
        outcome
    }

    /// Marks the run cancelled and `signal`s its process until its statement ends, for at
    /// most `RESIGNAL_FOR`: a signal that reaches the process before the statement does
    /// finds it idle, and is lost.
    async fn cancel<F: Future<Output = Result<(), AppError>>>(&self, signal: impl Fn(i32) -> F) -> Result<(), AppError> {
        self.cancelled.store(true, Ordering::SeqCst);
        let started = tokio::time::Instant::now();
        loop {
            let in_statement = self.in_statement.lock().await;
            if !*in_statement || self.ended.load(Ordering::SeqCst) {
                return Ok(());
            }
            signal(self.pid).await?;
            drop(in_statement);
            if started.elapsed() >= RESIGNAL_FOR {
                return Ok(());
            }
            tokio::time::sleep(RESIGNAL_AFTER).await;
        }
    }
}

/// Keeps a run registered for as long as it's alive — however the query ends.
pub(super) struct RunGuard(Arc<Run>);

impl Drop for RunGuard {
    fn drop(&mut self) {
        self.0.ended.store(true, Ordering::SeqCst);
        if let Ok(mut map) = running().lock() {
            map.remove(&self.0.id);
        }
    }
}

/// Registers the query about to run on `conn` under `run_id`; it is cancellable only
/// within `Run::on`.
pub(super) async fn register(conn: &mut sqlx::PgConnection, run_id: &str) -> Result<RunGuard, AppError> {
    let pid: i32 = match sqlx::query_scalar("SELECT pg_backend_pid()").fetch_one(&mut *conn).await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    let run = Arc::new(Run::new(run_id, pid));
    if let Ok(mut map) = running().lock() {
        map.insert(run_id.to_string(), run.clone());
    }
    Ok(RunGuard(run))
}

/// `statement`'s outcome, cancellable when it runs under a registered `run`.
pub(super) async fn cancellable<T>(run: Option<&RunGuard>, statement: impl Future<Output = Result<T, AppError>>) -> Result<T, AppError> {
    match run {
        Some(run) => run.0.on(statement).await,
        None => statement.await,
    }
}

/// Cancels the query running under `run_id`; false when none is (it already finished).
pub(crate) async fn cancel_query_impl(pool: &sqlx::PgPool, run_id: &str) -> Result<bool, AppError> {
    let found = running().lock().ok().and_then(|map| map.get(run_id).cloned());
    let Some(run) = found else { return Ok(false) };
    let signal = |pid: i32| async move {
        match sqlx::query("SELECT pg_cancel_backend($1)").bind(pid).execute(pool).await {
            Ok(_) => Ok(()),
            Err(e) => Err(AppError::Postgres(e)),
        }
    };
    run.cancel(signal).await?;
    Ok(true)
}

#[tauri::command]
pub async fn cancel_pg_query(ctx: State<'_, AppContext>, id: String, run_id: String) -> Result<bool, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    cancel_query_impl(&pool, &run_id).await
}

#[cfg(test)]
#[path = "cancel.test.rs"]
mod tests;
