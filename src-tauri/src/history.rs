use crate::error::AppError;
use crate::json_store::JsonStore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

const MAX_HISTORY: usize = 50;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct QueryHistoryEntry {
    pub id: String,
    pub mode: String,
    pub filter: String,
    pub sort: String,
    pub projection: String,
    pub skip: i64,
    pub limit: i64,
    pub pipeline: String,
    pub ran_at: String,
}

pub struct HistoryStorage {
    inner: JsonStore<HashMap<String, Vec<QueryHistoryEntry>>>,
}

impl HistoryStorage {
    pub fn new(path: PathBuf) -> Self {
        Self { inner: JsonStore::new(path) }
    }

    pub fn get(&self, key: &str) -> Vec<QueryHistoryEntry> {
        let map = self.inner.load();
        match map.get(key) {
            Some(entries) => entries.clone(),
            None => Vec::new(),
        }
    }

    pub fn push(&self, key: &str, entry: QueryHistoryEntry) -> Result<(), AppError> {
        self.inner.update(|map| {
            let entries = map.entry(key.to_string()).or_insert_with(Vec::new);
            entries.retain(|e| !is_same_query(e, &entry));
            entries.insert(0, entry);
            entries.truncate(MAX_HISTORY);
        })
    }

    pub fn clear(&self, key: &str) -> Result<(), AppError> {
        self.inner.update(|map| {
            map.remove(key);
        })
    }
}

fn is_same_query(a: &QueryHistoryEntry, b: &QueryHistoryEntry) -> bool {
    a.mode == b.mode
        && a.filter == b.filter
        && a.sort == b.sort
        && a.projection == b.projection
        && a.skip == b.skip
        && a.limit == b.limit
        && a.pipeline == b.pipeline
}

