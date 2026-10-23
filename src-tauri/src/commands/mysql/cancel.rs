//! Stopping a running SQL run: Cancel, or the time limit. A run is kept under the run id
//! the frontend chose for it from before it has a session, so a Cancel that comes while
//! it waits for one still stops it; once it has one, stopping it also sends `KILL QUERY`
//! for that session from a second connection. A statement is checked against the stop
//! itself, since `SELECT SLEEP(30)` stopped that way returns 1 rather than an error.
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use sqlx::MySqlPool;
use tauri::State;

use super::AppContext;
use crate::error::AppError;

/// MySQL's `max_execution_time` stopping a SELECT.
const TIME_LIMIT_EXCEEDED: u16 = 3024;

#[derive(Clone, Copy)]
enum Stop {
    Cancelled,
    TimedOut,
}

/// A run's session, once it has one, and what stopped it, if anything has.
struct Running {
    connection: Mutex<Option<u64>>,
    stop: Mutex<Option<Stop>>,
}

impl Running {
    /// Stops the statement running now and every one after it; false when the run was
    /// already stopped.
    async fn stop(&self, pool: &MySqlPool, why: Stop) -> Result<bool, AppError> {
        if self.stop.lock().unwrap().replace(why).is_some() {
            return Ok(false);
        }
        let connection = *self.connection.lock().unwrap();
        if let Some(connection) = connection {
            sqlx::raw_sql(sqlx::AssertSqlSafe(format!("KILL QUERY {connection}"))).execute(pool).await.map_err(AppError::MySql)?;
        }
        Ok(true)
    }

    fn stopped(&self) -> Result<(), AppError> {
        match *self.stop.lock().unwrap() {
            Some(Stop::Cancelled) => Err(AppError::Cancelled),
            Some(Stop::TimedOut) => Err(AppError::TimedOut),
            None => Ok(()),
        }
    }
}

fn running() -> &'static Mutex<HashMap<String, Arc<Running>>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, Arc<Running>>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// One run, findable by Cancel under its run id, if it has one, for as long as it lives.
pub(super) struct Run {
    id: Option<String>,
    running: Arc<Running>,
}

impl Run {
    pub(super) fn new(id: Option<&str>) -> Run {
        let run = Run { id: id.map(str::to_string), running: Arc::new(Running { connection: Mutex::new(None), stop: Mutex::new(None) }) };
        if let Some(id) = &run.id {
            running().lock().unwrap().insert(id.clone(), run.running.clone());
        }
        run
    }

    /// The run's session, `connection`, which stopping it from now on stops on the server too.
    pub(super) fn attach(&self, connection: u64) {
        *self.running.connection.lock().unwrap() = Some(connection);
    }

    /// An error if the run was stopped.
    pub(super) fn stopped(&self) -> Result<(), AppError> {
        self.running.stopped()
    }

    /// `statement`'s outcome, unless the run was stopped before or while it ran: past
    /// `limit`, it is stopped as timed out, since MySQL's own limit covers SELECTs only.
    pub(super) async fn limited<T>(&self, pool: &MySqlPool, limit: Duration, statement: impl Future<Output = Result<T, AppError>>) -> Result<T, AppError> {
        self.running.stopped()?;
        let timer = {
            let (pool, running) = (pool.clone(), self.running.clone());
            tokio::spawn(async move {
                tokio::time::sleep(limit).await;
                running.stop(&pool, Stop::TimedOut).await
            })
        };
        let outcome = statement.await;
        timer.abort();
        self.running.stopped()?;
        match outcome {
            Err(AppError::MySql(sqlx::Error::Database(e)))
                if e.try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>().is_some_and(|e| e.number() == TIME_LIMIT_EXCEEDED) =>
            {
                Err(AppError::TimedOut)
            }
            outcome => outcome,
        }
    }
}

impl Drop for Run {
    fn drop(&mut self) {
        if let Some(id) = &self.id {
            running().lock().unwrap().remove(id);
        }
    }
}

/// Cancels the run under `run_id`; false when none is running (it already finished).
pub(crate) async fn cancel_mysql_run(pool: &MySqlPool, run_id: &str) -> Result<bool, AppError> {
    let found = running().lock().unwrap().get(run_id).cloned();
    match found {
        Some(run) => run.stop(pool, Stop::Cancelled).await,
        None => Ok(false),
    }
}

#[tauri::command]
pub async fn cancel_mysql_query(ctx: State<'_, AppContext>, id: String, run_id: String) -> Result<bool, AppError> {
    let pool = ctx.mysql_pool(&id, None).await?;
    cancel_mysql_run(&pool, &run_id).await
}
