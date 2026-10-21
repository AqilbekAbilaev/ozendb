use crate::sync::run::{LastSync, SyncStatus};
use crate::sync::schedule::SyncLoop;
use tauri::State;

/// Asks for a sync now; its result arrives as the `sync-status` event.
#[tauri::command(async)]
pub fn sync_now(sync: State<'_, SyncLoop>) {
    sync.sync_now();
}

/// The latest sync status, for a window that opens after it was sent.
#[tauri::command(async)]
pub fn sync_status(last: State<'_, LastSync>) -> Option<SyncStatus> {
    last.status()
}
