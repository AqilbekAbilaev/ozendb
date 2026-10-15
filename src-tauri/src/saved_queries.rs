use crate::json_store_wrapper;
use crate::error::AppError;
use crate::record::{Record, RecordList, Stamp};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
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
    #[serde(flatten)]
    pub stamp:      Stamp,
}

crate::stamped!(SavedQueryEntry);

impl Record for SavedQueryEntry {
    fn id(&self) -> String {
        self.id.clone()
    }

    fn emptied(&self) -> Self {
        SavedQueryEntry { id: self.id.clone(), ..SavedQueryEntry::default() }
    }
}

json_store_wrapper!(SavedQueryStorage, records of SavedQueryEntry);

impl SavedQueryStorage {
    pub fn insert(&self, entry: SavedQueryEntry) -> Result<(), AppError> {
        self.inner.update(|entries| entries.put(0, entry))
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        self.inner.update(|entries| entries.delete_where(|e| e.id == id))
    }
}

#[cfg(test)]
#[path = "saved_queries.test.rs"]
mod tests;
