// The single source of truth for the Operations pane: every long-running operation
// the app runs (queries, aggregations, exports, imports, …) is recorded here, and the
// frontend pane is a thin display layer that fetches this list and refreshes on the
// `operations-changed` event. This is deliberately the *one place* operations are
// tracked — commands report in via the `tracked` helper (commands/mod.rs) rather than
// each call site keeping its own log.
//
// Two tiers: `live` holds operations still running this session (memory only — a
// "running" record from a previous session is meaningless after a restart); `store`
// is the persisted log of terminal (succeeded/failed/cancelled) records, shaped like
// the other JSON stores (see history.rs / json_store.rs).

use crate::json_store::JsonStore;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

// Cap on how many terminal records we keep (and hand to the UI). Oldest fall off.
const MAX_OPERATIONS: usize = 200;

/// One tracked operation as the frontend sees it. Field names serialize to camelCase
/// so the Vue pane reads `op.opType`, `op.startedAt`, `op.elapsedMs`, etc.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OperationRecord {
    pub id: String,
    pub op_type: String,
    pub label: String,
    pub connection_id: Option<String>,
    pub conn_name: Option<String>,
    pub database: Option<String>,
    pub collection: Option<String>,
    // "running" | "succeeded" | "failed" | "cancelled"
    pub status: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub elapsed_ms: Option<i64>,
    // Row count / bytes on success, error message on failure.
    pub detail: Option<String>,
}

/// The inputs a command supplies when it starts tracking an operation. The registry
/// fills in the id, timestamps, and status.
pub struct OpMeta {
    pub op_type: String,
    pub label: String,
    pub connection_id: Option<String>,
    pub conn_name: Option<String>,
    pub database: Option<String>,
    pub collection: Option<String>,
}

pub struct OperationsRegistry {
    // In-flight operations for this session (memory only).
    live: Mutex<Vec<OperationRecord>>,
    // Persisted terminal records, newest first.
    store: JsonStore<Vec<OperationRecord>>,
    // Held so start/finish can announce a change to the frontend. `None` in unit
    // tests, which exercise the store/live tiers without a running Tauri app.
    app: Option<AppHandle>,
}

impl OperationsRegistry {
    pub fn new(path: PathBuf, app: AppHandle) -> Self {
        Self { live: Mutex::new(Vec::new()), store: JsonStore::new(path), app: Some(app) }
    }

    /// Begin tracking an operation; returns its id. The record enters `live` as
    /// `running` until a matching `finish`.
    pub fn start(&self, meta: OpMeta) -> String {
        let id = format!("op-{}", uuid::Uuid::new_v4());
        let record = OperationRecord {
            id: id.clone(),
            op_type: meta.op_type,
            label: meta.label,
            connection_id: meta.connection_id,
            conn_name: meta.conn_name,
            database: meta.database,
            collection: meta.collection,
            status: String::from("running"),
            started_at: crate::time::now_epoch_ms(),
            finished_at: None,
            elapsed_ms: None,
            detail: None,
        };
        {
            let mut live = self.lock_live();
            live.push(record);
        }
        self.emit();
        id
    }

    /// Move a running operation to a terminal state: stamp the finish time + elapsed,
    /// drop it from `live`, and persist it to the terminal log. Best-effort — an
    /// unknown id (already finished/cancelled) is a no-op, and a persistence failure
    /// is swallowed so recording an op never breaks the op it describes.
    pub fn finish(&self, id: &str, status: &str, detail: Option<String>) {
        let mut record = {
            let mut live = self.lock_live();
            match live.iter().position(|r| r.id == id) {
                Some(index) => live.remove(index),
                None => return,
            }
        };
        let finished = crate::time::now_epoch_ms();
        record.finished_at = Some(finished);
        record.elapsed_ms = Some(finished - record.started_at);
        record.status = status.to_string();
        record.detail = detail;
        let _ = self.store.update(|list| {
            list.insert(0, record.clone());
            list.truncate(MAX_OPERATIONS);
        });
        self.emit();
    }

    /// The full list the pane renders: still-running ops plus the persisted terminal
    /// log, newest first, capped.
    pub fn list(&self) -> Vec<OperationRecord> {
        let mut result: Vec<OperationRecord> = {
            let live = self.lock_live();
            live.clone()
        };
        let mut terminal = self.store.load();
        result.append(&mut terminal);
        result.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        result.truncate(MAX_OPERATIONS);
        result
    }

    /// Drop the persisted terminal log (running ops are untouched).
    pub fn clear_finished(&self) {
        let _ = self.store.save(&Vec::new());
        self.emit();
    }

    fn emit(&self) {
        if let Some(app) = &self.app {
            let _ = app.emit("operations-changed", ());
        }
    }

    fn lock_live(&self) -> std::sync::MutexGuard<'_, Vec<OperationRecord>> {
        match self.live.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    // An app-less registry for exercising the store/live tiers directly.
    fn test_registry(path: PathBuf) -> OperationsRegistry {
        OperationsRegistry { live: Mutex::new(Vec::new()), store: JsonStore::new(path), app: None }
    }

    fn meta(op_type: &str) -> OpMeta {
        OpMeta {
            op_type: op_type.to_string(),
            label: format!("{} op", op_type),
            connection_id: Some(String::from("conn-1")),
            conn_name: Some(String::from("Local")),
            database: Some(String::from("db")),
            collection: Some(String::from("coll")),
        }
    }

    #[test]
    fn running_op_is_listed_then_moves_to_terminal_on_finish() {
        let dir = tempdir().unwrap();
        let registry = test_registry(dir.path().join("operations.json"));

        let id = registry.start(meta("export"));
        let running = registry.list();
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].status, "running");
        assert_eq!(running[0].finished_at, None);

        registry.finish(&id, "succeeded", Some(String::from("3 documents")));
        let done = registry.list();
        assert_eq!(done.len(), 1);
        assert_eq!(done[0].status, "succeeded");
        assert_eq!(done[0].detail.as_deref(), Some("3 documents"));
        assert!(done[0].finished_at.is_some());
        assert!(done[0].elapsed_ms.is_some());
    }

    #[test]
    fn only_terminal_records_persist_across_reload() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("operations.json");

        let registry = test_registry(path.clone());
        let finished_id = registry.start(meta("export"));
        registry.finish(&finished_id, "succeeded", None);
        // A still-running op exists only in memory.
        let _running_id = registry.start(meta("import"));
        assert_eq!(registry.list().len(), 2);

        // A fresh registry over the same file sees only the terminal record — the
        // running one was memory-only and does not survive a "restart".
        let reloaded = test_registry(path);
        let after = reloaded.list();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].status, "succeeded");
    }

    #[test]
    fn clear_finished_empties_the_persisted_log() {
        let dir = tempdir().unwrap();
        let registry = test_registry(dir.path().join("operations.json"));
        let id = registry.start(meta("export"));
        registry.finish(&id, "succeeded", None);
        assert_eq!(registry.list().len(), 1);
        registry.clear_finished();
        assert_eq!(registry.list().len(), 0);
    }
}
