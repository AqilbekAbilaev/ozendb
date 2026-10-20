//! Everything that syncs, as one value: what this device holds, and once encrypted, the
//! blob the server stores. A sync reads it, merges it with the downloaded copy, uploads
//! the result, and only then writes it back, store by store, where nothing changed
//! meanwhile.

use crate::default_queries::{DefaultQuery, DefaultQueryStorage};
use crate::error::AppError;
use crate::folders::{Folder, FolderStorage};
use crate::keychain::Keychain;
use crate::known_hosts::{KnownHost, KnownHostsStore};
use crate::node_tags::{NodeTag, NodeTagStorage};
use crate::postgres::query_library::{PgQueryLibraryStore, SavedSql};
use crate::record::Record;
use crate::saved_queries::{SavedQueryEntry, SavedQueryStorage};
use crate::settings::{SettingsStorage, StampedSettings};
use crate::storage::{ConnectionConfig, Storage};
use crate::sync::local_only::without_local_only;
use crate::sync::merge::Merge;
use crate::sync::secrets::SyncedConnection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use zeroize::Zeroizing;

/// The blob's format. A device refuses a newer one: uploading it back without the
/// stores it doesn't know would erase them on every device.
const FORMAT: u32 = 1;

pub struct SyncedStores<'a> {
    pub connections: &'a Storage,
    pub folders: &'a FolderStorage,
    pub saved_queries: &'a SavedQueryStorage,
    pub pg_queries: &'a PgQueryLibraryStore,
    pub default_queries: &'a DefaultQueryStorage,
    pub node_tags: &'a NodeTagStorage,
    pub settings: &'a SettingsStorage,
    pub known_hosts: &'a KnownHostsStore,
}

/// Every synced record, deleted markers included, and each connection's secrets.
#[derive(Deserialize, Clone, Debug)]
pub struct Snapshot {
    connections: Vec<SyncedConnection>,
    folders: Vec<Folder>,
    saved_queries: Vec<SavedQueryEntry>,
    pg_saved: Vec<SavedSql>,
    default_queries: HashMap<String, DefaultQuery>,
    node_tags: HashMap<String, NodeTag>,
    settings: StampedSettings,
    known_hosts: Vec<KnownHost>,
}

/// The blob as it is uploaded: the snapshot without this device's local-only settings.
#[derive(Serialize)]
struct Blob<'a> {
    format: u32,
    connections: &'a [SyncedConnection],
    folders: &'a [Folder],
    saved_queries: &'a [SavedQueryEntry],
    pg_saved: &'a [SavedSql],
    default_queries: &'a HashMap<String, DefaultQuery>,
    node_tags: &'a HashMap<String, NodeTag>,
    settings: Value,
    known_hosts: &'a [KnownHost],
}

/// What writing a merged snapshot back did.
#[derive(Debug)]
pub struct Written {
    /// False when a store changed after it was read and was left alone: sync again.
    pub complete: bool,
    /// Connections whose record or secrets changed, deleted or dropped ones included, so
    /// their pooled clients must be dropped.
    pub changed_connections: Vec<String>,
    /// A secret the keychain refused to change. Everything else was still written, and
    /// the next sync writes that secret again.
    pub keychain_error: Option<AppError>,
}

impl Snapshot {
    /// Fails when the keychain can't be read, so a locked keychain can never pass for
    /// connections without secrets.
    pub fn read(stores: &SyncedStores, keychain: &impl Keychain) -> Result<Self, AppError> {
        let connections = stores
            .connections
            .records()
            .into_iter()
            .map(|config| SyncedConnection::collect(config, keychain))
            .collect::<Result<_, _>>()?;
        Ok(Snapshot {
            connections,
            folders: stores.folders.inner.load(),
            saved_queries: stores.saved_queries.inner.load(),
            pg_saved: stores.pg_queries.saved_records(),
            default_queries: stores.default_queries.inner.load(),
            node_tags: stores.node_tags.inner.load(),
            settings: stores.settings.load(),
            known_hosts: stores.known_hosts.inner.load(),
        })
    }

    /// The bytes to encrypt and upload.
    pub fn encode(&self) -> Result<Zeroizing<Vec<u8>>, AppError> {
        let blob = Blob {
            format: FORMAT,
            connections: &self.connections,
            folders: &self.folders,
            saved_queries: &self.saved_queries,
            pg_saved: &self.pg_saved,
            default_queries: &self.default_queries,
            node_tags: &self.node_tags,
            settings: shared_settings(&self.settings)?,
            known_hosts: &self.known_hosts,
        };
        Ok(Zeroizing::new(serde_json::to_vec(&blob)?))
    }

    /// The snapshot in decrypted downloaded bytes. Parse errors are not passed on: their
    /// text can quote the data, secrets included.
    pub fn decode(bytes: &[u8]) -> Result<Self, AppError> {
        #[derive(Deserialize)]
        struct Format {
            format: u32,
        }
        let Format { format } = serde_json::from_slice(bytes).map_err(|_| AppError::UnreadableSyncData)?;
        if format > FORMAT {
            return Err(AppError::NewerSyncFormat);
        }
        serde_json::from_slice(bytes).map_err(|_| AppError::UnreadableSyncData)
    }

    pub fn merged(self, remote: Snapshot, merge: &Merge) -> Snapshot {
        let configs = |list: &[SyncedConnection]| list.iter().map(|c| c.config().clone()).collect();
        let connections = merge
            .connections(configs(&self.connections), configs(&remote.connections))
            .into_iter()
            .map(|config| with_winning_secrets(config, &self.connections, &remote.connections))
            .collect();
        Snapshot {
            connections,
            folders: merge.records(self.folders, remote.folders),
            saved_queries: merge.records(self.saved_queries, remote.saved_queries),
            pg_saved: merge.records(self.pg_saved, remote.pg_saved),
            default_queries: merge.keyed(self.default_queries, remote.default_queries),
            node_tags: merge.keyed(self.node_tags, remote.node_tags),
            settings: merge.settings(self.settings, remote.settings),
            known_hosts: merge.records(self.known_hosts, remote.known_hosts),
        }
    }

    /// Whether the two hold the same synced records, in whatever order: when the merged
    /// result is the same as the downloaded one, there is nothing to upload.
    pub fn same_as(&self, other: &Snapshot) -> Result<bool, AppError> {
        Ok(self.secrets_match(other) && self.comparable()? == other.comparable()?)
    }

    /// Writes this merged snapshot over `before`, the one read at the start of the sync.
    /// Each store is replaced only if it still holds what `before` read, so an edit made
    /// during the sync is never lost; it goes up on the next sync.
    pub fn write_if_unchanged(&self, before: &Snapshot, stores: &SyncedStores, keychain: &impl Keychain) -> Result<Written, AppError> {
        let configs = |snapshot: &Snapshot| snapshot.connections.iter().map(|c| c.config().clone()).collect::<Vec<_>>();
        let mut changed_connections = Vec::new();
        let mut keychain_error = None;
        let mut complete = stores.connections.replace_synced_if_unchanged(&configs(before), configs(self))?;
        if complete {
            // A connection the merge dropped altogether leaves as one with nothing stored.
            let dropped: Vec<SyncedConnection> = before
                .connections
                .iter()
                .filter(|b| !self.connections.iter().any(|c| c.id() == b.id()))
                .map(Record::emptied)
                .collect();
            for connection in self.connections.iter().chain(&dropped) {
                let previous = before.connections.iter().find(|b| b.id() == connection.id());
                if !connection.differs_from(previous) {
                    continue;
                }
                // After the records, so a refused secret leaves the newer record, whose
                // secrets the next sync takes from the server again.
                if connection.secrets_differ(previous) {
                    if let Err(e) = connection.save_secrets(keychain) {
                        keychain_error.get_or_insert(e);
                    }
                }
                changed_connections.push(connection.id());
            }
        }
        complete &= stores.folders.inner.replace_if_unchanged(&before.folders, &self.folders)?;
        complete &= stores.saved_queries.inner.replace_if_unchanged(&before.saved_queries, &self.saved_queries)?;
        complete &= stores.pg_queries.replace_saved_if_unchanged(&before.pg_saved, self.pg_saved.clone())?;
        complete &= stores.default_queries.inner.replace_if_unchanged(&before.default_queries, &self.default_queries)?;
        complete &= stores.node_tags.inner.replace_if_unchanged(&before.node_tags, &self.node_tags)?;
        complete &= stores.settings.inner.replace_if_unchanged(&before.settings, &self.settings)?;
        complete &= stores.known_hosts.inner.replace_if_unchanged(&before.known_hosts, &self.known_hosts)?;
        Ok(Written { complete, changed_connections, keychain_error })
    }

    fn secrets_match(&self, other: &Snapshot) -> bool {
        self.connections.len() == other.connections.len()
            && self.connections.iter().all(|mine| {
                let theirs = other.connections.iter().find(|c| c.config().id == mine.config().id);
                theirs.is_some() && !mine.secrets_differ(theirs)
            })
    }

    // Everything but the secrets, with each list keyed by id so its order doesn't count.
    fn comparable(&self) -> Result<Value, AppError> {
        Ok(json!({
            "connections": by_id(self.connections.iter().map(|c| c.config().shared_part()))?,
            "folders": by_id(self.folders.iter().cloned())?,
            "saved_queries": by_id(self.saved_queries.iter().cloned())?,
            "pg_saved": by_id(self.pg_saved.iter().cloned())?,
            "default_queries": serde_json::to_value(&self.default_queries)?,
            "node_tags": serde_json::to_value(&self.node_tags)?,
            "settings": shared_settings(&self.settings)?,
            "known_hosts": by_id(self.known_hosts.iter().cloned())?,
        }))
    }
}

/// The merged record with the secrets of the side it came from. When both sides hold the
/// same record, the server's secrets win, so every device settles on one copy.
fn with_winning_secrets(config: ConnectionConfig, local: &[SyncedConnection], remote: &[SyncedConnection]) -> SyncedConnection {
    let shared = serde_json::to_value(config.shared_part()).ok();
    let same_id = |c: &&SyncedConnection| c.config().id == config.id;
    let from = remote
        .iter()
        .find(|c| same_id(c) && serde_json::to_value(c.config().shared_part()).ok() == shared)
        .or_else(|| local.iter().find(same_id))
        .or_else(|| remote.iter().find(same_id));
    match from {
        Some(side) => side.clone().with_config(config),
        None => unreachable!("a merged connection comes from one of the two sides"),
    }
}

fn by_id<R: Record + Serialize>(records: impl Iterator<Item = R>) -> Result<Value, AppError> {
    let keyed: BTreeMap<String, R> = records.map(|r| (r.id(), r)).collect();
    Ok(serde_json::to_value(keyed)?)
}

/// The settings without this device's local-only ones, values and stamps alike.
fn shared_settings(settings: &StampedSettings) -> Result<Value, AppError> {
    let Value::Object(mut map) = serde_json::to_value(settings)? else {
        unreachable!("settings always serialize to a JSON object")
    };
    if let Some(Value::Object(stamps)) = map.remove("updated_at") {
        map.insert("updated_at".into(), Value::Object(without_local_only(stamps)));
    }
    Ok(Value::Object(without_local_only(map)))
}

#[cfg(test)]
#[path = "snapshot.test.rs"]
mod tests;
