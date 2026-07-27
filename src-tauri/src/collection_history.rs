use crate::json_store_wrapper;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

// Newest-N cap: Collection History is a convenience safety net (undo an edit/delete), not
// an audit log, so old entries roll off to keep the file bounded.
const MAX_ENTRIES: usize = 500;

/// One recorded single-document change, enough to reverse it later. `before` holds the
// pre-image (canonical Extended JSON) for updates and deletes so restore can put it back;
// an insert has no pre-image, and its restore is a delete of `doc_id`.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HistoryEntry {
    pub id: String,
    pub conn_id: String,
    pub database: String,
    pub collection: String,
    pub op: String, // "insert" | "update" | "delete"
    pub at: i64,    // epoch milliseconds
    pub doc_id: String,          // the document's _id, as Extended JSON
    pub before: Option<String>,  // the pre-image document, as Extended JSON (update/delete)
}

// Persisted change history across all collections, newest-first, capped at `MAX_ENTRIES`.
json_store_wrapper!(CollectionHistoryStore, Vec<HistoryEntry>);

impl CollectionHistoryStore {
    /// Record a change at the front (newest-first), trimming to the cap.
    pub fn push(&self, entry: HistoryEntry) -> Result<(), AppError> {
        self.inner.update(|entries| {
            entries.insert(0, entry);
            if entries.len() > MAX_ENTRIES {
                entries.truncate(MAX_ENTRIES);
            }
        })
    }

    // Every entry for one collection, newest-first.
    pub fn list_for(&self, conn_id: &str, database: &str, collection: &str) -> Vec<HistoryEntry> {
        self.load()
            .into_iter()
            .filter(|entry| {
                entry.conn_id == conn_id
                    && entry.database == database
                    && entry.collection == collection
            })
            .collect()
    }

    // A single entry by id (for restore).
    pub fn get(&self, entry_id: &str) -> Option<HistoryEntry> {
        self.load()
            .into_iter()
            .find(|entry| entry.id == entry_id)
    }

    // Drop every entry for one collection.
    pub fn clear_for(&self, conn_id: &str, database: &str, collection: &str) -> Result<(), AppError> {
        self.inner.update(|entries| {
            entries.retain(|entry| {
                !(entry.conn_id == conn_id
                    && entry.database == database
                    && entry.collection == collection)
            });
        })
    }
}
