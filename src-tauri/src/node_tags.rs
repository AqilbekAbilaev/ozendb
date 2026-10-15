use crate::json_store_wrapper;
use crate::error::AppError;
use crate::record::{RecordMap, Stamp};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// Persisted colour tags for database and collection tree nodes. Connections
// carry their own tag on `ConnectionConfig` (in `connections.json`); this store
// covers the deeper nodes, keyed by their tree path:
//   database   -> "connId/dbName"
//   collection -> "connId/dbName/collName"
// The colour is a name ("blue", "green", …). Clearing a node marks its entry
// deleted, so the file only holds live tags and tombstones.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(from = "StoredTag")]
pub struct NodeTag {
    pub color: String,
    #[serde(flatten)]
    pub stamp: Stamp,
}

crate::stamped!(NodeTag);

#[derive(Deserialize)]
#[serde(untagged)]
enum StoredTag {
    Stamped {
        color: String,
        #[serde(flatten)]
        stamp: Stamp,
    },
    // Files written before stamps existed hold the bare colour.
    Bare(String),
}

impl From<StoredTag> for NodeTag {
    fn from(stored: StoredTag) -> Self {
        match stored {
            StoredTag::Stamped { color, stamp } => NodeTag { color, stamp },
            StoredTag::Bare(color) => NodeTag { color, stamp: Stamp::default() },
        }
    }
}

json_store_wrapper!(NodeTagStorage, keyed records of NodeTag);

impl NodeTagStorage {
    /// Each tagged node's colour, by node key.
    pub fn colors(&self) -> HashMap<String, String> {
        self.load().into_iter().map(|(key, tag)| (key, tag.color)).collect()
    }

    pub fn set(&self, key: &str, color: &str) -> Result<(), AppError> {
        let tag = NodeTag { color: color.to_string(), stamp: Stamp::now() };
        self.inner.update(|map| map.put(key, tag))
    }

    pub fn clear(&self, key: &str) -> Result<(), AppError> {
        self.inner.update(|map| map.delete_where(|k| k == key))
    }

    // Drop every tag whose key starts with `prefix`. Used to reset a subtree:
    // clearing a connection's descendants (prefix "connId/") or a database's
    // collections (prefix "connId/dbName/") so they take the parent's new colour.
    pub fn remove_under(&self, prefix: &str) -> Result<(), AppError> {
        self.inner.update(|map| map.delete_where(|key| key.starts_with(prefix)))
    }

    // Drop every tag belonging to a connection — called when the connection is
    // deleted so its database/collection tags don't linger as orphans. Keys are
    // "connId/…", so a deleted id's entries all share the "connId/" prefix.
    pub fn remove_connection(&self, conn_id: &str) -> Result<(), AppError> {
        self.remove_under(&format!("{}/", conn_id))
    }
}

#[cfg(test)]
#[path = "node_tags.test.rs"]
mod tests;
