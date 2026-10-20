//! What this device knows about the server's copy: when it last synced, and the version
//! it last saw together with that version's contents, so a "not modified" answer can
//! still be merged against. Device state: it never syncs.
use crate::json_store_wrapper;
use crate::sync::pass::ServerCopy;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct SyncState {
    /// When this device last finished a sync, in epoch milliseconds.
    pub last_sync: Option<i64>,
    /// The server's copy as of that sync.
    pub server: Option<ServerCopy>,
}

json_store_wrapper!(SyncStateStorage, SyncState);
