//! PostgreSQL's saved SQL and run history. Separate from MongoDB's `history.rs` /
//! `saved_queries.rs`, whose entries are shaped for MongoDB queries (filter, sort,
//! projection…); here a query is just SQL. Keyed by connection, since a PostgreSQL
//! connection is bound to one database.
use crate::error::AppError;
use crate::json_store_wrapper;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub(crate) const MAX_HISTORY: usize = 50;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SqlHistoryEntry {
    pub sql: String,
    pub ran_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SavedSql {
    pub id: String,
    pub name: String,
    pub connection_id: String,
    pub sql: String,
    pub saved_at: String,
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
        self.load().saved.into_iter().filter(|q| q.connection_id == connection_id).collect()
    }

    pub fn save(&self, id: &str, name: &str, connection_id: &str, sql: &str, saved_at: &str) -> Result<(), AppError> {
        let entry = SavedSql {
            id: id.to_string(),
            name: name.to_string(),
            connection_id: connection_id.to_string(),
            sql: sql.to_string(),
            saved_at: saved_at.to_string(),
        };
        self.inner.update(|lib| lib.saved.insert(0, entry))
    }

    pub fn delete_saved(&self, id: &str) -> Result<(), AppError> {
        self.inner.update(|lib| lib.saved.retain(|q| q.id != id))
    }

    /// Both the run history and the saved SQL: a saved query is bound to its connection.
    pub fn remove_connection(&self, connection_id: &str) -> Result<(), AppError> {
        self.inner.update(|lib| {
            lib.history.remove(connection_id);
            lib.saved.retain(|q| q.connection_id != connection_id);
        })
    }
}

#[cfg(test)]
#[path = "query_library.test.rs"]
mod tests;
