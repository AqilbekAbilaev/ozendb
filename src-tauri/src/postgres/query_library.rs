//! The saved SQL and run history of every SQL engine, PostgreSQL's first, hence the
//! name and the file it keeps (`pg_queries.json`). Separate from MongoDB's `history.rs` /
//! `saved_queries.rs`, whose entries are shaped for MongoDB queries (filter, sort,
//! projection…); here a query is just SQL. Keyed by connection.
use crate::error::AppError;
use crate::json_store_wrapper;
use crate::record::{Record, RecordList, Stamp};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub(crate) const MAX_HISTORY: usize = 50;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SqlHistoryEntry {
    pub sql: String,
    pub ran_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SavedSql {
    pub id: String,
    pub name: String,
    pub connection_id: String,
    pub sql: String,
    pub saved_at: String,
    #[serde(flatten)]
    pub stamp: Stamp,
}

crate::stamped!(SavedSql);

impl Record for SavedSql {
    fn id(&self) -> String {
        self.id.clone()
    }

    fn emptied(&self) -> Self {
        SavedSql { id: self.id.clone(), ..SavedSql::default() }
    }
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct PgQueryLibrary {
    #[serde(default)]
    history: HashMap<String, Vec<SqlHistoryEntry>>,
    #[serde(default)]
    saved: Vec<SavedSql>,
}

json_store_wrapper!(PgQueryLibraryStore, PgQueryLibrary);

impl PgQueryLibraryStore {
    pub fn history(&self, connection_id: &str) -> Vec<SqlHistoryEntry> {
        self.load().history.get(connection_id).cloned().unwrap_or_default()
    }

    /// Newest first; running the same SQL again moves it to the top.
    pub fn push_history(&self, connection_id: &str, sql: &str, ran_at: &str) -> Result<(), AppError> {
        let sql = sql.trim().to_string();
        self.inner.update(|lib| {
            let entries = lib.history.entry(connection_id.to_string()).or_default();
            entries.retain(|e| e.sql != sql);
            entries.insert(0, SqlHistoryEntry { sql, ran_at: ran_at.to_string() });
            entries.truncate(MAX_HISTORY);
        })
    }

    pub fn clear_history(&self, connection_id: &str) -> Result<(), AppError> {
        self.inner.update(|lib| {
            lib.history.remove(connection_id);
        })
    }

    pub fn saved(&self, connection_id: &str) -> Vec<SavedSql> {
        self.load().saved.live().into_iter().filter(|q| q.connection_id == connection_id).collect()
    }

    /// Every saved query, deleted markers included: what sync sends.
    pub fn saved_records(&self) -> Vec<SavedSql> {
        self.load().saved
    }

    /// Replaces the saved queries with `after` only if they still equal `before`. The run
    /// history doesn't sync and is left alone. Returns whether it replaced them.
    pub fn replace_saved_if_unchanged(&self, before: &[SavedSql], after: Vec<SavedSql>) -> Result<bool, AppError> {
        let before = serde_json::to_value(before)?;
        self.inner.update_if(|lib| {
            if serde_json::to_value(&lib.saved).ok() != Some(before) {
                return false;
            }
            lib.saved = after;
            true
        })
    }

    pub fn save(&self, id: &str, name: &str, connection_id: &str, sql: &str, saved_at: &str) -> Result<(), AppError> {
        let entry = SavedSql {
            id: id.to_string(),
            name: name.to_string(),
            connection_id: connection_id.to_string(),
            sql: sql.to_string(),
            saved_at: saved_at.to_string(),
            stamp: Stamp::now(),
        };
        self.inner.update(|lib| lib.saved.put(0, entry))
    }

    pub fn delete_saved(&self, id: &str) -> Result<(), AppError> {
        self.inner.update(|lib| lib.saved.delete_where(|q| q.id == id))
    }

    /// Both the run history and the saved SQL: a saved query is bound to its connection.
    pub fn remove_connection(&self, connection_id: &str) -> Result<(), AppError> {
        self.inner.update(|lib| {
            lib.history.remove(connection_id);
            lib.saved.delete_where(|q| q.connection_id == connection_id);
        })
    }
}

#[cfg(test)]
#[path = "query_library.test.rs"]
mod tests;
