use crate::commands::postgres::ColumnValue;
use crate::error::AppError;
use crate::json_store_wrapper;
use serde::{Deserialize, Serialize};

// Mirrors `collection_history.rs`'s cap: a convenience safety net (undo an edit), not
// an audit log, so old entries roll off to keep the file bounded.
const MAX_ENTRIES: usize = 500;

/// One changed column: what it held before the edit and what it holds now. `before`
/// is never missing — unlike MongoDB's whole-document pre-image, Postgres already
/// knows exactly which columns an UPDATE touched, so there is nothing else to show.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PgColumnChange {
    pub column: String,
    pub before: serde_json::Value,
    pub after: serde_json::Value,
}

/// One recorded row edit, enough to identify and reverse it later. Scoped to
/// `update_pg_row` only (ozendb-h4y v1) — SQL-tab statement effects and inserts/
/// deletes aren't tracked here, the same scope MongoDB's history draws per-command.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PgHistoryEntry {
    pub id: String,
    pub conn_id: String,
    pub database: String,
    pub schema: String,
    pub table: String,
    pub at: i64, // epoch milliseconds
    /// The row's primary-key column(s) and values — identifies which row this was,
    /// the same shape `update_pg_row`'s own `where` takes.
    pub key: Vec<ColumnValue>,
    pub changes: Vec<PgColumnChange>,
}

// Persisted row-edit history across all tables, newest-first, capped at `MAX_ENTRIES`.
json_store_wrapper!(PgRowHistoryStore, Vec<PgHistoryEntry>);

impl PgRowHistoryStore {
    /// Record a change at the front (newest-first), trimming to the cap.
    pub fn push(&self, entry: PgHistoryEntry) -> Result<(), AppError> {
        self.inner.update(|entries| {
            entries.insert(0, entry);
            if entries.len() > MAX_ENTRIES {
                entries.truncate(MAX_ENTRIES);
            }
        })
    }

    pub fn list_for(&self, conn_id: &str, database: &str, schema: &str, table: &str) -> Vec<PgHistoryEntry> {
        self.load()
            .into_iter()
            .filter(|entry| {
                entry.conn_id == conn_id
                    && entry.database == database
                    && entry.schema == schema
                    && entry.table == table
            })
            .collect()
    }

    pub fn get(&self, entry_id: &str) -> Option<PgHistoryEntry> {
        self.load().into_iter().find(|entry| entry.id == entry_id)
    }

    pub fn clear_for(&self, conn_id: &str, database: &str, schema: &str, table: &str) -> Result<(), AppError> {
        self.inner.update(|entries| {
            entries.retain(|entry| {
                !(entry.conn_id == conn_id
                    && entry.database == database
                    && entry.schema == schema
                    && entry.table == table)
            });
        })
    }
}

#[cfg(test)]
#[path = "pg_row_history.test.rs"]
mod tests;
