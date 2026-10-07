use crate::json_store_wrapper;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

// Collection History is a convenience safety net (undo an edit/delete), not an audit log,
// so old entries roll off to keep the file bounded: by count, and by the total size of the
// pre-images, because every change rewrites the whole file and a document can be 16 MB.
const LIMITS: Limits = Limits {
    max_entries: 500,
    max_pre_image_bytes: 256 * 1024,
    max_total_bytes: 8 * 1024 * 1024,
};

pub(crate) struct Limits {
    pub max_entries: usize,
    pub max_pre_image_bytes: usize,
    pub max_total_bytes: usize,
}

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
    // The pre-image was over the size cap and wasn't kept, so this change can't be undone.
    #[serde(default)]
    pub pre_image_dropped: bool,
}

impl HistoryEntry {
    /// Why this change can't be undone, or `None` when it can. An insert needs no
    /// pre-image: undoing it deletes the document.
    pub fn restore_blocker(&self) -> Option<&'static str> {
        if self.op == "insert" || self.before.is_some() {
            None
        } else if self.pre_image_dropped {
            Some("This document was too large to keep a copy of, so this change can't be undone.")
        } else {
            Some("This change has no saved pre-image to restore.")
        }
    }
}

/// Add `entry` newest-first, then trim to `limits`. A pre-image over the cap isn't kept,
/// but the change still is, flagged; the newest entry always stays, even alone over budget.
fn add(entries: &mut Vec<HistoryEntry>, mut entry: HistoryEntry, limits: &Limits) {
    if entry.before.as_ref().is_some_and(|before| before.len() > limits.max_pre_image_bytes) {
        entry.before = None;
        entry.pre_image_dropped = true;
    }
    entries.insert(0, entry);
    entries.truncate(limits.max_entries);
    let mut total = 0;
    let within = entries
        .iter()
        .position(|e| {
            total += e.before.as_ref().map_or(0, String::len);
            total > limits.max_total_bytes
        })
        .unwrap_or(entries.len());
    entries.truncate(within.max(1));
}

// Persisted change history across all collections, newest-first, within `LIMITS`.
json_store_wrapper!(CollectionHistoryStore, Vec<HistoryEntry>);

impl CollectionHistoryStore {
    /// Record a change at the front (newest-first), trimming to the limits.
    pub fn push(&self, entry: HistoryEntry) -> Result<(), AppError> {
        self.inner.update(|entries| add(entries, entry, &LIMITS))
    }

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

    pub fn get(&self, entry_id: &str) -> Option<HistoryEntry> {
        self.load()
            .into_iter()
            .find(|entry| entry.id == entry_id)
    }

    pub fn remove_connection(&self, conn_id: &str) -> Result<(), AppError> {
        self.inner.update(|entries| entries.retain(|entry| entry.conn_id != conn_id))
    }

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

#[cfg(test)]
#[path = "collection_history.test.rs"]
mod tests;
