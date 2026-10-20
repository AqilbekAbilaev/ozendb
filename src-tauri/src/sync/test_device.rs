//! A whole device for sync tests: every synced store in a temporary directory, and a
//! fake keychain.
use crate::folders::{Folder, FolderStorage};
use crate::default_queries::DefaultQueryStorage;
use crate::keychain::fake::FakeKeychain;
use crate::known_hosts::KnownHostsStore;
use crate::node_tags::NodeTagStorage;
use crate::postgres::query_library::PgQueryLibraryStore;
use crate::record::Stamp;
use crate::saved_queries::SavedQueryStorage;
use crate::settings::SettingsStorage;
use crate::storage::{ConnectionConfig, Storage};
use crate::sync::snapshot::{Snapshot, SyncedStores, Written};
use crate::sync::state::SyncStateStorage;
use tempfile::TempDir;

/// Every synced store, in a temporary directory.
pub(crate) struct Device {
    _dir: TempDir,
    pub(crate) connections: Storage,
    pub(crate) folders: FolderStorage,
    pub(crate) saved_queries: SavedQueryStorage,
    pub(crate) pg_queries: PgQueryLibraryStore,
    pub(crate) default_queries: DefaultQueryStorage,
    pub(crate) node_tags: NodeTagStorage,
    pub(crate) settings: SettingsStorage,
    pub(crate) known_hosts: KnownHostsStore,
    pub(crate) keychain: FakeKeychain,
    pub(crate) state: SyncStateStorage,
}

impl Device {
    pub(crate) fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let at = |name: &str| dir.path().join(name);
        Device {
            connections: Storage::new(at("connections.json")),
            folders: FolderStorage::new(at("folders.json")),
            saved_queries: SavedQueryStorage::new(at("saved_queries.json")),
            pg_queries: PgQueryLibraryStore::new(at("pg_queries.json")),
            default_queries: DefaultQueryStorage::new(at("default_queries.json")),
            node_tags: NodeTagStorage::new(at("node_tags.json")),
            settings: SettingsStorage::new(at("settings.json")),
            known_hosts: KnownHostsStore::new(at("known_hosts.json")),
            keychain: FakeKeychain::default(),
            state: SyncStateStorage::new(at("sync_state.json")),
            _dir: dir,
        }
    }

    pub(crate) fn stores(&self) -> SyncedStores<'_> {
        SyncedStores {
            connections: &self.connections,
            folders: &self.folders,
            saved_queries: &self.saved_queries,
            pg_queries: &self.pg_queries,
            default_queries: &self.default_queries,
            node_tags: &self.node_tags,
            settings: &self.settings,
            known_hosts: &self.known_hosts,
        }
    }

    /// Stores the connection with its own stamp, as another device or an older save left it.
    pub(crate) fn hold(&self, config: ConnectionConfig) {
        self.connections.update_with(|list| list.push(config)).unwrap();
    }

    pub(crate) fn read(&self) -> Snapshot {
        Snapshot::read(&self.stores(), &self.keychain).unwrap()
    }

    pub(crate) fn write(&self, merged: &Snapshot, before: &Snapshot) -> Written {
        merged.write_if_unchanged(before, &self.stores(), &self.keychain).unwrap()
    }
}

pub(crate) fn connection(id: &str, name: &str, updated_at: i64) -> ConnectionConfig {
    let stamp = Stamp { updated_at, deleted: false, uploaded_at: None };
    ConnectionConfig { id: id.into(), name: name.into(), stamp, ..ConnectionConfig::default() }
}

pub(crate) fn folder(id: &str, name: &str, updated_at: i64) -> Folder {
    let stamp = Stamp { updated_at, deleted: false, uploaded_at: None };
    Folder { id: id.into(), name: name.into(), stamp, ..Folder::default() }
}
