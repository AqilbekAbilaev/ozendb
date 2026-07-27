use crate::json_store_wrapper;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DefaultQuery {
    pub mode:       String,
    pub filter:     String,
    pub sort:       String,
    pub projection: String,
    pub skip:       i64,
    pub limit:      i64,
    pub pipeline:   String,
}

json_store_wrapper!(DefaultQueryStorage, HashMap<String, DefaultQuery>);

impl DefaultQueryStorage {
    pub fn get(&self, key: &str) -> Option<DefaultQuery> {
        self.load().remove(key)
    }

    pub fn set(&self, key: &str, entry: DefaultQuery) -> Result<(), AppError> {
        self.inner.update(|map| {
            map.insert(key.to_string(), entry);
        })
    }

    pub fn clear(&self, key: &str) -> Result<(), AppError> {
        self.inner.update(|map| {
            map.remove(key);
        })
    }
}
