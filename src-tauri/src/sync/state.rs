//! What this device knows about the server's copy: when it last synced, and the version
//! it last saw together with that version's contents, so a "not modified" answer can
//! still be merged against. Device state: it never syncs.
use crate::json_store_wrapper;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SyncState {
    /// When this device last finished a sync, in epoch milliseconds.
    pub last_sync: Option<i64>,
    /// The server's copy as of that sync.
    pub server: Option<ServerCopy>,
}

/// What the server stores, as it sends and takes it: base64 text.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Contents {
    pub blob: String,
    pub wrapped_key: String,
    pub recovery_wrapped_key: Option<String>,
}

/// The server's copy and the version that names it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ServerCopy {
    pub version: String,
    pub contents: Contents,
}

json_store_wrapper!(SyncStateStorage, SyncState);
