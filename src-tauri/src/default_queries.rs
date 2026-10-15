use crate::json_store_wrapper;
use crate::error::AppError;
use crate::record::{RecordMap, Stamp};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct DefaultQuery {
    pub mode:       String,
    pub filter:     String,
    pub sort:       String,
    pub projection: String,
    pub skip:       i64,
    pub limit:      i64,
    pub pipeline:   String,
    #[serde(flatten)]
    pub stamp:      Stamp,
}

crate::stamped!(DefaultQuery);

json_store_wrapper!(DefaultQueryStorage, keyed records of DefaultQuery);

impl DefaultQueryStorage {
    pub fn get(&self, key: &str) -> Option<DefaultQuery> {
        self.load().remove(key)
    }

    pub fn set(&self, key: &str, entry: DefaultQuery) -> Result<(), AppError> {
        self.inner.update(|map| map.put(key, entry))
    }

    pub fn clear(&self, key: &str) -> Result<(), AppError> {
        self.inner.update(|map| map.delete_where(|k| k == key))
    }

    // Keys are "connId::db::coll" (see commands/persistence.rs).
    pub fn remove_connection(&self, conn_id: &str) -> Result<(), AppError> {
        let prefix = format!("{}::", conn_id);
        self.inner.update(|map| map.delete_where(|key| key.starts_with(&prefix)))
    }
}

#[cfg(test)]
#[path = "default_queries.test.rs"]
mod tests;
