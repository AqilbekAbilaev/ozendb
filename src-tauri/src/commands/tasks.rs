// Commands backing the Tasks panel: create/read/update/delete of task
// definitions, the run engine (`run_task_now`, shared by the manual `run_task`
// command and the in-app scheduler), and the per-task run log.

use crate::error::AppError;
use crate::shell::ShellEngine;
use crate::tasks::{is_due, now_epoch_ms, now_ms, TaskDef, TaskRun, TaskSpec, TaskStore};
use serde::Serialize;
use std::collections::HashSet;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

use super::AppContext;

// How often the in-app scheduler wakes to look for due tasks.
const TICK: Duration = Duration::from_secs(30);

/// All saved tasks, newest-first (list order as stored).
#[tauri::command]
pub fn list_tasks(store: State<'_, TaskStore>) -> Vec<TaskDef> {
    store.load()
}

/// Create or update a task. A blank id means "create": we mint a fresh uuid and
/// stamp `created_at`. A non-blank id updates the existing task in place.
/// Returns the task's id either way.
#[tauri::command]
pub fn save_task(store: State<'_, TaskStore>, task: TaskDef) -> Result<String, AppError> {
    let mut task = task;
    if task.id.trim().is_empty() {
        task.id = Uuid::new_v4().to_string();
        task.created_at = now_ms();
    }
    let id = task.id.clone();
    match store.upsert(task) {
        Ok(()) => Ok(id),
        Err(e) => Err(e),
    }
}

/// Delete a task.
#[tauri::command]
pub fn delete_task(store: State<'_, TaskStore>, id: String) -> Result<(), AppError> {
    store.delete(&id)
}

/// Run a task once, on demand. Stamps `last_run`/`last_status`, then returns
/// the run so the UI can show it.
#[tauri::command]
pub async fn run_task(app: AppHandle, id: String) -> Result<TaskRun, AppError> {
    // Look the task up and drop the store handle before the run's `.await`.
    let task = {
        let store = app.state::<TaskStore>();
        match store.find(&id) {
            Some(value) => value,
            None => return Err(AppError::Validation(format!("no task with id {}", id))),
        }
    };
    let run = run_task_now(&app, &task).await;
    match persist_run(&app, &id, &run) {
        Ok(()) => {}
        Err(e) => return Err(e),
    }
    Ok(run)
}

// Stamp a task's `last_run`/`last_status` after a run. Shared by the manual
// `run_task` command and the scheduler.
fn persist_run(app: &AppHandle, id: &str, run: &TaskRun) -> Result<(), AppError> {
    app.state::<TaskStore>()
        .record_run(id, &run.ran_at, &run.status)
}

/// The single entry point that actually runs a task. It resolves managed state
/// from the `AppHandle` — so the scheduler (which only holds an `AppHandle`, not a
/// request `State`) and the manual `run_task` command share exactly one code path —
/// and dispatches to the existing operation command for the task's spec. It always
/// returns a `TaskRun`: a failure is captured as an "error" run rather than
/// propagated, so one bad run can never derail the scheduler loop.
pub async fn run_task_now(app: &AppHandle, task: &TaskDef) -> TaskRun {
    let outcome = execute_spec(app, task).await;
    let ran_at = now_ms();
    match outcome {
        Ok(message) => TaskRun {
            ran_at: ran_at,
            status: String::from("ok"),
            message: message,
        },
        Err(e) => TaskRun {
            ran_at: ran_at,
            status: String::from("error"),
            message: e.to_string(),
        },
    }
}

// Dispatch to the operation command matching the task's spec, forwarding the
// managed state each one needs. Returns a short human-readable success message
// for the run log (or the operation's error).
async fn execute_spec(app: &AppHandle, task: &TaskDef) -> Result<String, AppError> {
    let id = task.connection_id.clone();
    match &task.spec {
        TaskSpec::Export {
            database,
            collection,
            path,
            format,
        } => {
            let count = match super::export_collection(
                app.state::<AppContext>(),
                app.state::<crate::operations::OperationsRegistry>(),
                id,
                database.clone(),
                collection.clone(),
                path.clone(),
                format.clone(),
            )
            .await
            {
                Ok(value) => value,
                Err(e) => return Err(e),
            };
            Ok(format!("Exported {} document(s) to {}", count, path))
        }
        TaskSpec::Import {
            database,
            collection,
            path,
            format,
        } => {
            let count = match super::import_collection(
                app.state::<AppContext>(),
                app.state::<crate::operations::OperationsRegistry>(),
                id,
                database.clone(),
                collection.clone(),
                path.clone(),
                format.clone(),
            )
            .await
            {
                Ok(value) => value,
                Err(e) => return Err(e),
            };
            Ok(format!("Imported {} document(s) from {}", count, path))
        }
        TaskSpec::Masking {
            database,
            collection,
            filter,
            rules,
            path,
            format,
            limit,
        } => {
            let count = match super::export_masked_collection(
                app.state::<AppContext>(),
                id,
                database.clone(),
                collection.clone(),
                filter.clone(),
                rules.clone(),
                path.clone(),
                format.clone(),
                *limit,
            )
            .await
            {
                Ok(value) => value,
                Err(e) => return Err(e),
            };
            Ok(format!("Exported {} masked document(s) to {}", count, path))
        }
        TaskSpec::Shell { database, code } => {
            // A task has no live console tab, so run the script in a throwaway
            // session (fresh JS context) and drop it afterwards.
            let session_id = Uuid::new_v4().to_string();
            let result = super::run_shell_command(
                app.state::<AppContext>(),
                app.state::<ShellEngine>(),
                id,
                database.clone(),
                session_id.clone(),
                code.clone(),
            )
            .await;
            // Close the session whether the eval succeeded or failed.
            app.state::<ShellEngine>().close(session_id);
            let transcript = match result {
                Ok(value) => value,
                Err(e) => return Err(e),
            };
            match transcript.error {
                Some(message) => Err(AppError::Shell(message)),
                None => Ok(shell_summary(&transcript)),
            }
        }
    }
}

// Flatten a shell transcript (printed lines + completion value) into one message
// for the run log.
fn shell_summary(result: &crate::shell::ShellResult) -> String {
    let mut summary = result.logs.join("\n");
    if let Some(value) = &result.value {
        if !summary.is_empty() {
            summary.push('\n');
        }
        summary.push_str(&value.to_string());
    }
    if summary.is_empty() {
        return String::from("Script completed");
    }
    summary
}

// ── In-app scheduler ──────────────────────────────────────────────────────
//
// A single background task (spawned from `lib.rs` setup) that wakes every `TICK`,
// runs any scheduled task whose next-due time has arrived, and persists + announces
// each outcome. Because the very first tick runs immediately (before the first
// sleep), a task that became due while the app was closed catches up on launch.

// The frontend `task-ran` event payload: which task ran and how it went, so an open
// Tasks panel can refresh its list and toast the result.
#[derive(Clone, Serialize)]
struct TaskRanEvent {
    task_id: String,
    run: TaskRun,
}

/// Start the in-app scheduler. Holds a clone of the `AppHandle` so it can resolve
/// managed state on each tick; runs for the life of the app.
pub fn spawn_scheduler(app: AppHandle) {
    // Task ids currently executing, so a task that outlives a tick isn't started a
    // second time on the next tick.
    let in_flight: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    tauri::async_runtime::spawn(async move {
        loop {
            scheduler_tick(&app, &in_flight);
            tokio::time::sleep(TICK).await;
        }
    });
}

// One scheduler pass: fire every due, not-already-running scheduled task. Each run
// is spawned so a slow task neither blocks the others nor delays the next tick; the
// overlap guard keeps the next tick from re-firing a task still in flight.
fn scheduler_tick(app: &AppHandle, in_flight: &Arc<Mutex<HashSet<String>>>) {
    let now = now_epoch_ms();
    let tasks = app.state::<TaskStore>().load();
    for task in tasks.into_iter() {
        let schedule = match &task.schedule {
            Some(value) => value.clone(),
            None => continue,
        };
        let created_at_ms = task.created_at.parse::<i64>().unwrap_or(0);
        if !is_due(&schedule, task.last_run.as_deref(), created_at_ms, now) {
            continue;
        }
        // Claim the task under the guard; skip if a previous run is still going.
        {
            let mut running = lock_set(in_flight);
            if running.contains(&task.id) {
                continue;
            }
            running.insert(task.id.clone());
        }
        let app_handle = app.clone();
        let guard_handle = Arc::clone(in_flight);
        tauri::async_runtime::spawn(async move {
            run_and_announce(&app_handle, &task).await;
            let mut running = lock_set(&guard_handle);
            running.remove(&task.id);
        });
    }
}

// Run a scheduled task, persist the outcome, and emit `task-ran`. Errors from
// persistence/emit are non-fatal to the scheduler, so they are only logged.
async fn run_and_announce(app: &AppHandle, task: &TaskDef) {
    let run = run_task_now(app, task).await;
    match persist_run(app, &task.id, &run) {
        Ok(()) => {}
        Err(e) => eprintln!("[ozendb] task run persist failed: {}", e),
    }
    let event = TaskRanEvent {
        task_id: task.id.clone(),
        run: run,
    };
    match app.emit("task-ran", event) {
        Ok(()) => {}
        Err(e) => eprintln!("[ozendb] task-ran emit failed: {}", e),
    }
}

// Lock the overlap-guard set, tolerating a poisoned mutex the same way the JSON
// stores do (a panic in a holder shouldn't wedge the scheduler).
fn lock_set(set: &Arc<Mutex<HashSet<String>>>) -> MutexGuard<'_, HashSet<String>> {
    match set.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}
