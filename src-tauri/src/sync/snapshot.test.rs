use super::*;
use crate::keychain::fake::{FakeKeychain, LockedKeychain};
use crate::record::Stamp;
use crate::settings::Settings;
use tempfile::TempDir;

const DAY: i64 = 24 * 60 * 60 * 1000;
const NOW: i64 = 1_000 * DAY;

/// Every synced store, in a temporary directory.
struct Device {
    _dir: TempDir,
    connections: Storage,
    folders: FolderStorage,
    saved_queries: SavedQueryStorage,
    pg_queries: PgQueryLibraryStore,
    default_queries: DefaultQueryStorage,
    node_tags: NodeTagStorage,
    settings: SettingsStorage,
    known_hosts: KnownHostsStore,
    keychain: FakeKeychain,
}

impl Device {
    fn new() -> Self {
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
            _dir: dir,
        }
    }

    fn stores(&self) -> SyncedStores<'_> {
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
    fn hold(&self, config: ConnectionConfig) {
        self.connections.update_with(|list| list.push(config)).unwrap();
    }

    fn read(&self) -> Snapshot {
        Snapshot::read(&self.stores(), &self.keychain).unwrap()
    }

    fn write(&self, merged: &Snapshot, before: &Snapshot) -> Written {
        merged.write_if_unchanged(before, &self.stores(), &self.keychain).unwrap()
    }
}

fn connection(id: &str, name: &str, updated_at: i64) -> ConnectionConfig {
    let stamp = Stamp { updated_at, deleted: false, uploaded_at: None };
    ConnectionConfig { id: id.into(), name: name.into(), stamp, ..ConnectionConfig::default() }
}

fn folder(id: &str, name: &str, updated_at: i64) -> Folder {
    let stamp = Stamp { updated_at, deleted: false, uploaded_at: None };
    Folder { id: id.into(), name: name.into(), stamp, ..Folder::default() }
}

fn merge() -> Merge {
    Merge::new(NOW, Some(NOW - DAY))
}

fn decoded(snapshot: &Snapshot) -> Snapshot {
    Snapshot::decode(&snapshot.encode().unwrap()).unwrap()
}

fn text(snapshot: &Snapshot) -> String {
    String::from_utf8(snapshot.encode().unwrap().to_vec()).unwrap()
}

#[test]
fn reading_includes_deleted_markers() {
    let device = Device::new();
    device.folders.insert(folder("f1", "kept", 1)).unwrap();
    device.folders.insert(folder("f2", "gone", 1)).unwrap();
    device.folders.delete("f2").unwrap();

    let snapshot = device.read();
    assert_eq!(snapshot.folders.len(), 2);
    assert!(snapshot.folders.iter().any(|f| f.id == "f2" && f.stamp.deleted));
}

#[test]
fn reading_carries_each_connections_password() {
    let device = Device::new();
    device.hold(connection("c1", "prod", 1));
    device.keychain.write("c1", "s3cret").unwrap();

    assert!(text(&device.read()).contains("s3cret"));
}

#[test]
fn reading_fails_when_the_keychain_is_locked() {
    let device = Device::new();
    device.hold(connection("c1", "prod", 1));

    let result = Snapshot::read(&device.stores(), &LockedKeychain);
    assert_eq!(result.unwrap_err().code(), "keychain");
}

#[test]
fn reading_takes_postgres_saved_sql_but_not_its_run_history() {
    let device = Device::new();
    device.pg_queries.save("q1", "count", "c1", "select 1", "now").unwrap();
    device.pg_queries.push_history("c1", "select 2", "now").unwrap();

    let blob = text(&device.read());
    assert!(blob.contains("select 1"));
    assert!(!blob.contains("select 2"));
}

#[test]
fn the_upload_leaves_out_local_only_settings() {
    let device = Device::new();
    device.settings.update(|s| Settings { ui_zoom: 1.5, theme: "light".into(), ..s.clone() }).unwrap();

    let blob = text(&device.read());
    assert!(blob.contains("light"));
    assert!(!blob.contains("ui_zoom"));
}

#[test]
fn a_decoded_upload_holds_the_same_records() {
    let device = Device::new();
    device.hold(connection("c1", "prod", 1));
    device.keychain.write("c1", "s3cret").unwrap();
    device.node_tags.set("c1/shop", "red").unwrap();

    let snapshot = device.read();
    assert!(decoded(&snapshot).same_as(&snapshot).unwrap());
}

#[test]
fn a_newer_format_is_refused() {
    let error = Snapshot::decode(br#"{"format": 2}"#).unwrap_err();
    assert_eq!(error.code(), "newer_sync_format");
}

#[test]
fn unreadable_data_is_reported_without_quoting_it() {
    let error = Snapshot::decode(br#"{"format": 1, "connections": "s3cret"}"#).unwrap_err();
    assert_eq!(error.code(), "unreadable_sync_data");
    assert!(!error.to_string().contains("s3cret"));
}

#[test]
fn order_does_not_make_two_snapshots_differ() {
    let a = Device::new();
    a.folders.insert(folder("f1", "one", 1)).unwrap();
    a.folders.insert(folder("f2", "two", 1)).unwrap();
    let b = Device::new();
    b.folders.inner.save(&a.folders.inner.load().into_iter().rev().collect()).unwrap();

    assert!(a.read().same_as(&b.read()).unwrap());
}

#[test]
fn a_different_password_makes_two_snapshots_differ() {
    let a = Device::new();
    a.hold(connection("c1", "prod", 1));
    a.keychain.write("c1", "old").unwrap();
    let before = a.read();
    a.keychain.write("c1", "new").unwrap();

    assert!(!a.read().same_as(&before).unwrap());
}

#[test]
fn the_password_comes_from_the_side_whose_record_won() {
    let mine = Device::new();
    mine.hold(connection("c1", "prod", 1));
    mine.keychain.write("c1", "mine").unwrap();
    let theirs = Device::new();
    theirs.hold(connection("c1", "prod renamed", 5));
    theirs.keychain.write("c1", "theirs").unwrap();

    let remote_won = mine.read().merged(decoded(&theirs.read()), &merge());
    let local_won = theirs.read().merged(decoded(&mine.read()), &merge());
    assert!(text(&remote_won).contains("theirs"));
    assert!(!text(&remote_won).contains("mine"));
    assert!(text(&local_won).contains("theirs"));
}

#[test]
fn writing_back_saves_every_store_and_the_won_passwords() {
    let device = Device::new();
    device.hold(connection("c1", "prod", 1));
    device.keychain.write("c1", "old").unwrap();
    let other = Device::new();
    other.hold(connection("c1", "prod", 9));
    other.keychain.write("c1", "new").unwrap();
    other.folders.insert(folder("f1", "from elsewhere", 9)).unwrap();

    let before = device.read();
    let merged = before.clone().merged(decoded(&other.read()), &merge());
    let written = device.write(&merged, &before);

    assert_eq!(written, Written { complete: true, secrets_changed: vec!["c1".into()] });
    assert_eq!(device.keychain.read("c1").unwrap().as_deref().map(String::as_str), Some("new"));
    assert_eq!(device.folders.load()[0].name, "from elsewhere");
}

#[test]
fn a_store_edited_during_the_sync_is_left_alone() {
    let device = Device::new();
    let other = Device::new();
    other.folders.insert(folder("f1", "from elsewhere", 9)).unwrap();
    other.node_tags.set("c1/shop", "red").unwrap();

    let before = device.read();
    let merged = before.clone().merged(decoded(&other.read()), &merge());
    device.folders.insert(folder("f2", "typed meanwhile", 10)).unwrap();
    let written = device.write(&merged, &before);

    assert!(!written.complete);
    let names: Vec<String> = device.folders.load().into_iter().map(|f| f.name).collect();
    assert_eq!(names, vec!["typed meanwhile"]);
    assert_eq!(device.node_tags.colors().get("c1/shop").map(String::as_str), Some("red"));
}

#[test]
fn opening_a_connection_during_the_sync_does_not_block_the_write() {
    let device = Device::new();
    device.hold(connection("c1", "prod", 1));
    let other = Device::new();
    other.hold(connection("c1", "prod renamed", 9));

    let before = device.read();
    let merged = before.clone().merged(decoded(&other.read()), &merge());
    device.connections.update_with(|list| list[0].open = true).unwrap();
    let written = device.write(&merged, &before);

    assert!(written.complete);
    let saved = &device.connections.load()[0];
    assert_eq!((saved.name.as_str(), saved.open), ("prod renamed", true));
}

#[test]
fn writing_back_keeps_postgres_run_history() {
    let device = Device::new();
    device.pg_queries.push_history("c1", "select 2", "now").unwrap();
    let other = Device::new();
    other.pg_queries.save("q1", "count", "c1", "select 1", "now").unwrap();

    let before = device.read();
    let merged = before.clone().merged(decoded(&other.read()), &merge());
    device.write(&merged, &before);

    assert_eq!(device.pg_queries.saved("c1").len(), 1);
    assert_eq!(device.pg_queries.history("c1").len(), 1);
}
