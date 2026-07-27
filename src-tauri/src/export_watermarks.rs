use crate::json_store_wrapper;
use crate::error::AppError;
use std::collections::HashMap;

// Persisted "high-water marks" for incremental export: the largest `_id` already
// exported for a collection, so a later incremental export only writes documents added
// since. Keyed by tree path "connId/dbName/collName"; the value is the boundary `_id`
// as a canonical Extended-JSON string (so any `_id` type — ObjectId, int, string —
// round-trips). An absent entry means "never exported incrementally" → export everything.
json_store_wrapper!(ExportWatermarkStorage, HashMap<String, String>);

impl ExportWatermarkStorage {
    pub fn get(&self, key: &str) -> Option<String> {
        self.load().get(key).cloned()
    }

    pub fn set(&self, key: &str, watermark: &str) -> Result<(), AppError> {
        self.inner.update(|map| {
            map.insert(key.to_string(), watermark.to_string());
        })
    }
}
