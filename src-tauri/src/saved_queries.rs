use crate::json_store_wrapper;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SavedQueryEntry {
    pub id:         String,
    pub name:       String,
    pub mode:       String,
    pub filter:     String,
    pub sort:       String,
    pub projection: String,
    pub skip:       i64,
    pub limit:      i64,
    pub pipeline:   String,
    pub saved_at:   String,
}

json_store_wrapper!(SavedQueryStorage, Vec<SavedQueryEntry>);

impl SavedQueryStorage {
    pub fn insert(&self, entry: SavedQueryEntry) -> Result<(), AppError> {
        self.inner.update(|entries| entries.insert(0, entry))
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        self.inner.update(|entries| entries.retain(|e| e.id != id))
    }
}
