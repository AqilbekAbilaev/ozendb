use crate::error::AppError;
use crate::error_log::{self, ErrorRecord};
use serde::Serialize;

/// The recorded defects, oldest first. Empty before anything has gone wrong (and in
/// any build where the recorder was never initialized).
#[tauri::command]
pub async fn list_error_log() -> Result<Vec<ErrorRecord>, AppError> {
    Ok(error_log::store().map(|store| store.list()).unwrap_or_default())
}

#[tauri::command]
pub async fn clear_error_log() -> Result<(), AppError> {
    match error_log::store() {
        Some(store) => store.clear(),
        None => Ok(()),
    }
}

/// An uncaught exception or rejected promise from the webview. Those never reach
/// `AppError`'s funnel, so the frontend hands them here instead.
#[tauri::command]
pub async fn record_frontend_error(message: String) -> Result<(), AppError> {
    error_log::record("frontend", &message);
    Ok(())
}

/// What a report needs beyond the errors themselves. Kept on this side so the build's
/// own version and target are the source of truth rather than anything the page knows.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportContext {
    pub version: &'static str,
    pub os: &'static str,
    pub arch: &'static str,
    /// The user's home directory, so the report can replace it with `~`. Our own file
    /// paths are the one place a recorded message carries the account name.
    pub home: String,
}

#[tauri::command]
pub async fn error_report_context() -> Result<ReportContext, AppError> {
    Ok(ReportContext {
        version: env!("CARGO_PKG_VERSION"),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        home: std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_default(),
    })
}
