// ── IntelliShell (embedded JavaScript shell) ──────────────────────────────

use crate::error::AppError;
use crate::shell::{ShellEngine, ShellResult};
use crate::shell_history::ShellHistoryStorage;
use tauri::State;

use super::{
    AppContext
};

/// Evaluate a block of JavaScript in the shell session identified by
/// `session_id`. Each session has its own persistent JS context, so variables
/// declared in one submission are visible in the next. The `db` global is bound
/// to `id`'s connection and `database`. Returns the transcript (printed lines,
/// completion value, or a JS error message).
#[tauri::command]
pub async fn run_shell_command(
    ctx: State<'_, AppContext>,
    shell: State<'_, ShellEngine>,
    id: String,
    database: String,
    session_id: String,
    code: String,
) -> Result<ShellResult, AppError> {
    // Resolve the connection exactly like find_documents so the shell shares the
    // same pooled client and credential flow.
    let client = ctx.client(&id).await?;

    // A read-only connection must refuse shell writes (insertOne/drop/…) just like
    // the rest of the app; reads still pass through.
    let read_only = match ctx.storage.find(&id) {
        Some(config) => config.read_only,
        None => false,
    };

    let handle = tokio::runtime::Handle::current();
    let receiver = shell.submit_eval(session_id, code, client, read_only, database, handle);
    match receiver.await {
        Ok(result) => Ok(result),
        Err(_) => Err(AppError::Shell(String::from(
            "the shell engine is unavailable",
        ))),
    }
}

/// Drop a shell session's JavaScript context (called when its tab is closed).
#[tauri::command]
pub async fn close_shell_session(
    shell: State<'_, ShellEngine>,
    session_id: String,
) -> Result<(), AppError> {
    shell.close(session_id);
    Ok(())
}

/// Persisted IntelliShell command history for a connection (oldest first).
#[tauri::command]
pub fn get_shell_history(
    history: State<'_, ShellHistoryStorage>,
    connection_id: String,
) -> Vec<String> {
    history.get(&connection_id)
}

#[tauri::command]
pub fn push_shell_command(
    history: State<'_, ShellHistoryStorage>,
    connection_id: String,
    command: String,
) -> Result<(), AppError> {
    history.push(&connection_id, command)
}

#[tauri::command]
pub fn clear_shell_history(
    history: State<'_, ShellHistoryStorage>,
    connection_id: String,
) -> Result<(), AppError> {
    history.clear(&connection_id)
}

/// Read a shell script file the user picked (Open Script). Returns its text so
/// the editor can load it. The frontend chooses the path via the OS file dialog.
#[tauri::command]
pub fn read_shell_script(path: String) -> Result<String, AppError> {
    match std::fs::read_to_string(&path) {
        Ok(val) => Ok(val),
        Err(e) => return Err(AppError::Io(e)),
    }
}

/// Write the editor's contents to a shell script file (Save Script). The
/// frontend chooses the path via the OS save dialog.
#[tauri::command]
pub fn write_shell_script(path: String, contents: String) -> Result<(), AppError> {
    match std::fs::write(&path, contents) {
        Ok(_) => Ok(()),
        Err(e) => return Err(AppError::Io(e)),
    }
}
