use crate::json_store_wrapper;
use crate::error::AppError;
use std::collections::HashMap;

// Persisted colour tags for database and collection tree nodes. Connections
// carry their own tag on `ConnectionConfig` (in `connections.json`); this store
// covers the deeper nodes, keyed by their tree path:
//   database   -> "connId/dbName"
//   collection -> "connId/dbName/collName"
// The value is a colour name ("blue", "green", …). Clearing a node removes its
// entry so the file only holds nodes that are actually tagged.
json_store_wrapper!(NodeTagStorage, HashMap<String, String>);

impl NodeTagStorage {
    pub fn set(&self, key: &str, color: &str) -> Result<(), AppError> {
        self.inner.update(|map| {
            map.insert(key.to_string(), color.to_string());
        })
    }

    pub fn clear(&self, key: &str) -> Result<(), AppError> {
        self.inner.update(|map| {
            map.remove(key);
        })
    }

    // Drop every tag whose key starts with `prefix`. Used to reset a subtree:
    // clearing a connection's descendants (prefix "connId/") or a database's
    // collections (prefix "connId/dbName/") so they take the parent's new colour.
    pub fn remove_under(&self, prefix: &str) -> Result<(), AppError> {
        self.inner.update(|map| {
            map.retain(|key, _| !key.starts_with(prefix));
        })
    }

    // Drop every tag belonging to a connection — called when the connection is
    // deleted so its database/collection tags don't linger as orphans. Keys are
    // "connId/…", so a deleted id's entries all share the "connId/" prefix.
    pub fn remove_connection(&self, conn_id: &str) -> Result<(), AppError> {
        self.remove_under(&format!("{}/", conn_id))
    }
}
