// A rolling local record of the failures that are OzenDB's own fault, so they can be
// reported with evidence instead of from memory.
//
// Deliberately NOT every error. A failed login or an unreachable host is the user's
// server or credentials — nothing a code change fixes, and reporting it would bury the
// real defects in noise. `is_defect` below is the allowlist, and it is the whole policy.
//
// Fed from `impl Serialize for AppError` (error.rs) — the single funnel every error
// returned to the frontend passes through. That impl is a plain trait method with no
// `AppHandle` in scope, so the store lives in a process global here rather than in
// Tauri's managed state like every other store. `init` is called once during setup.
//
// Nothing here leaves the machine. The full message is kept locally because it's the
// useful part when diagnosing; what gets shared is the user's decision, made in the UI
// against a report they can read first.

use crate::error::AppError;
use crate::json_store::JsonStore;
use crate::time::now_epoch_ms;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::OnceLock;

// Oldest records fall off past this. Errors are user-facing failures, so the volume is
// small; the cap exists so a connection retrying against a dead host can't grow the
// file without bound.
const MAX_RECORDS: usize = 200;

/// One recorded error. Field names serialize to camelCase for the Vue side.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ErrorRecord {
    /// Stable category from `AppError::code` — the part safe to share as-is.
    pub code: String,
    /// Full text as the user saw it. Local only; may name hosts, databases, documents.
    pub message: String,
    pub at: i64,
}

#[derive(Serialize, Deserialize, Default)]
pub struct ErrorLog {
    pub records: Vec<ErrorRecord>,
}

pub struct ErrorLogStore(JsonStore<ErrorLog>);

impl ErrorLogStore {
    pub fn new(path: PathBuf) -> Self {
        Self(JsonStore::new(path))
    }

    pub fn list(&self) -> Vec<ErrorRecord> {
        self.0.load().records
    }

    pub fn clear(&self) -> Result<(), AppError> {
        self.0.save(&ErrorLog::default())
    }

    pub fn record(&self, code: &str, message: &str) -> Result<(), AppError> {
        self.0.update(|log| {
            log.records.push(ErrorRecord {
                code: code.to_string(),
                message: message.to_string(),
                at: now_epoch_ms(),
            });
            let overflow = log.records.len().saturating_sub(MAX_RECORDS);
            if overflow > 0 {
                log.records.drain(0..overflow);
            }
        })
    }
}

static STORE: OnceLock<ErrorLogStore> = OnceLock::new();

/// Point the recorder at its file. Called once from setup; later calls are ignored.
pub fn init(path: PathBuf) {
    let _ = STORE.set(ErrorLogStore::new(path));
}

/// The store, or None before `init` (unit tests, and any error raised during setup
/// itself — recording is diagnostics, so it must never be what breaks a command).
pub fn store() -> Option<&'static ErrorLogStore> {
    STORE.get()
}

/// Is this error category a defect in OzenDB, rather than the user's environment?
///
/// Everything a user or their server can cause — a bad password (`auth`), an
/// unreachable host (`network`, `unreachable`, `tls`), a rejected command or write
/// (`mongo`, `write`, `read_only`), invalid input (`validation`, `bson`, `sql`), a
/// stale connection id (`unknown_connection`) — is a domain error and is not recorded.
/// What remains can only come from our own code: reading and writing our storage files
/// (`io`), our own JSON shapes (`serde`), the keychain integration, and the embedded
/// shell engine. Panics and uncaught frontend exceptions are recorded under their own
/// codes and are always defects.
pub fn is_defect(code: &str) -> bool {
    matches!(code, "io" | "serde" | "keychain" | "shell" | "panic" | "frontend")
}

/// Record an error if it's ours to fix. Failures to write are dropped on purpose: this
/// runs inside error serialization, where there is no caller left to tell.
pub fn record(code: &str, message: &str) {
    if !is_defect(code) {
        return;
    }
    if let Some(store) = store() {
        let _ = store.record(code, message);
    }
}

#[cfg(test)]
#[path = "error_log.test.rs"]
mod tests;
