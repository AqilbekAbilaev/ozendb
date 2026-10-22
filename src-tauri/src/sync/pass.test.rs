use super::*;
use crate::folders::Folder;
use crate::sync::state::SyncState;
use crate::sync::fake_server::FakeServer;
use crate::sync::test_device::{connection, folder, Device};
use crate::keychain::fake::FakeKeychain;
use std::cell::Cell;
use zeroize::Zeroizing;

const DAY: i64 = 24 * 60 * 60 * 1000;
const NOW: i64 = 1_000 * DAY;

fn data_key() -> DataKey {
    DataKey::generate().unwrap()
}

async fn sync_on(device: &Device, server: &FakeServer<'_>, key: &DataKey) -> Result<Synced, AppError> {
    let stores = device.stores();
    let local = Local { stores: &stores, keychain: &device.keychain, state: &device.state };
    let keys = Keys { data_key: key, wrapped_key: b"wrapped", recovery_wrapped_key: None };
    sync(&local, server, &keys, NOW).await
}

fn folder_names(device: &Device) -> Vec<String> {
    let mut names: Vec<String> = device.folders.load().into_iter().map(|f| f.name).collect();
    names.sort();
    names
}

/// What a device that has never synced receives from the server.
async fn received(server: &FakeServer<'_>, key: &DataKey) -> Vec<String> {
    let fresh = Device::new();
    sync_on(&fresh, server, key).await.unwrap();
    folder_names(&fresh)
}

#[tokio::test]
async fn the_first_sync_uploads_this_devices_data() {
    let (server, key) = (FakeServer::default(), data_key());
    let device = Device::new();
    device.folders.insert(folder("f1", "mine", 1)).unwrap();

    sync_on(&device, &server, &key).await.unwrap();

    assert_eq!(received(&server, &key).await, vec!["mine"]);
    let state = device.state.load();
    assert_eq!((state.last_sync, state.server.map(|s| s.version)), (Some(NOW), server.version()));
}

#[tokio::test]
async fn the_first_upload_carries_this_devices_wrapped_keys() {
    let (server, key) = (FakeServer::default(), data_key());

    sync_on(&Device::new(), &server, &key).await.unwrap();

    let contents = server.stored.borrow().clone().unwrap().contents;
    assert_eq!((contents.wrapped_key.as_str(), contents.recovery_wrapped_key), ("d3JhcHBlZA==", None));
}

#[tokio::test]
async fn a_second_device_receives_the_first_ones_data_and_uploads_nothing_new() {
    let (server, key) = (FakeServer::default(), data_key());
    let first = Device::new();
    first.folders.insert(folder("f1", "from the first", 1)).unwrap();
    sync_on(&first, &server, &key).await.unwrap();

    let second = Device::new();
    sync_on(&second, &server, &key).await.unwrap();

    assert_eq!(folder_names(&second), vec!["from the first"]);
    assert_eq!(server.uploads.get(), 1);
}

#[tokio::test]
async fn both_devices_edits_end_up_on_both() {
    let (server, key) = (FakeServer::default(), data_key());
    let (a, b) = (Device::new(), Device::new());
    a.folders.insert(folder("fa", "from a", 1)).unwrap();
    b.folders.insert(folder("fb", "from b", 1)).unwrap();

    sync_on(&a, &server, &key).await.unwrap();
    sync_on(&b, &server, &key).await.unwrap();
    sync_on(&a, &server, &key).await.unwrap();

    assert_eq!(folder_names(&a), vec!["from a", "from b"]);
    assert_eq!(folder_names(&b), vec!["from a", "from b"]);
}

#[tokio::test]
async fn an_unchanged_server_is_merged_against_the_kept_copy() {
    let (server, key) = (FakeServer::default(), data_key());
    let device = Device::new();
    device.folders.insert(folder("f1", "first", 1)).unwrap();
    sync_on(&device, &server, &key).await.unwrap();
    device.folders.insert(folder("f2", "second", 1)).unwrap();

    sync_on(&device, &server, &key).await.unwrap();

    assert_eq!(server.full_downloads.get(), 0);
    assert_eq!(received(&server, &key).await, vec!["first", "second"]);
}

#[tokio::test]
async fn another_device_uploading_first_starts_the_pass_again() {
    let (server, key) = (FakeServer::default(), data_key());
    let (mine, theirs) = (Device::new(), Device::new());
    sync_on(&mine, &server, &key).await.unwrap();
    theirs.folders.insert(folder("ft", "theirs", 1)).unwrap();
    let their_copy = {
        let elsewhere = FakeServer::default();
        sync_on(&theirs, &elsewhere, &key).await.unwrap();
        let contents = elsewhere.stored.borrow().clone().unwrap().contents;
        contents
    };
    mine.folders.insert(folder("fm", "mine", 1)).unwrap();
    server.meanwhile(move |server| {
        server.store(their_copy);
    });

    sync_on(&mine, &server, &key).await.unwrap();

    assert_eq!(folder_names(&mine), vec!["mine", "theirs"]);
    assert_eq!(received(&server, &key).await, vec!["mine", "theirs"]);
}

#[tokio::test]
async fn nothing_is_saved_here_when_the_upload_fails() {
    let (server, key) = (FakeServer::default(), data_key());
    let other = Device::new();
    other.folders.insert(folder("fo", "from elsewhere", 1)).unwrap();
    sync_on(&other, &server, &key).await.unwrap();
    let device = Device::new();
    device.folders.insert(folder("fm", "mine", 1)).unwrap();
    server.offline.set(true);

    assert!(sync_on(&device, &server, &key).await.is_err());

    assert_eq!(folder_names(&device), vec!["mine"]);
    assert_eq!(device.state.load().last_sync, None);
}

#[tokio::test]
async fn a_lapsed_device_still_receives_other_devices_changes() {
    let (server, key) = (FakeServer::default(), data_key());
    let other = Device::new();
    other.folders.insert(folder("fo", "from elsewhere", 1)).unwrap();
    sync_on(&other, &server, &key).await.unwrap();
    let device = Device::new();
    device.folders.insert(folder("fm", "mine", 1)).unwrap();
    server.lapsed.set(true);

    let synced = sync_on(&device, &server, &key).await.unwrap();

    assert!(synced.received_only);
    assert_eq!(folder_names(&device), vec!["from elsewhere", "mine"]);
    let state = device.state.load();
    assert_eq!((state.last_sync, state.server.map(|s| s.version)), (Some(NOW), server.version()));
    server.lapsed.set(false);
    assert_eq!(received(&server, &key).await, vec!["from elsewhere"]);
}

#[tokio::test]
async fn a_deletion_made_while_lapsed_starts_its_ninety_days_only_when_uploaded() {
    let (server, key) = (FakeServer::default(), data_key());
    let (device, other) = (Device::new(), Device::new());
    device.folders.insert(folder("fd", "deleted while lapsed", 1)).unwrap();
    sync_on(&device, &server, &key).await.unwrap();
    other.folders.insert(folder("fo", "from elsewhere", 1)).unwrap();
    sync_on(&other, &server, &key).await.unwrap();
    device.folders.delete("fd").unwrap();
    server.lapsed.set(true);

    sync_on(&device, &server, &key).await.unwrap();

    let marker = |folders: Vec<Folder>| folders.into_iter().find(|f| f.id == "fd").unwrap().stamp;
    assert_eq!(marker(device.folders.inner.load()).uploaded_at, None);
    server.lapsed.set(false);
    sync_on(&device, &server, &key).await.unwrap();
    assert_eq!(marker(device.folders.inner.load()).uploaded_at, Some(NOW));
    assert_eq!(received(&server, &key).await, vec!["from elsewhere"]);
}

#[tokio::test]
async fn a_lapsed_device_with_nothing_to_upload_syncs_as_usual() {
    let (server, key) = (FakeServer::default(), data_key());
    let other = Device::new();
    other.folders.insert(folder("fo", "from elsewhere", 1)).unwrap();
    sync_on(&other, &server, &key).await.unwrap();
    server.lapsed.set(true);
    let device = Device::new();

    let synced = sync_on(&device, &server, &key).await.unwrap();

    assert!(!synced.received_only);
    assert_eq!(server.uploads.get(), 1);
    assert_eq!(folder_names(&device), vec!["from elsewhere"]);
}

#[tokio::test]
async fn a_refused_first_upload_saves_nothing() {
    let (server, key) = (FakeServer::default(), data_key());
    let device = Device::new();
    device.folders.insert(folder("fm", "mine", 1)).unwrap();
    server.lapsed.set(true);

    let synced = sync_on(&device, &server, &key).await.unwrap();

    assert!(synced.received_only);
    assert_eq!(folder_names(&device), vec!["mine"]);
    let state = device.state.load();
    assert_eq!((state.last_sync, state.server), (None, None));
}

#[tokio::test]
async fn an_edit_made_during_the_pass_goes_up_on_the_next_one() {
    let device = Device::new();
    let (server, key) = (FakeServer::default(), data_key());
    device.folders.insert(folder("f1", "before", 1)).unwrap();
    server.meanwhile(|_| {
        device.folders.insert(folder("f2", "typed meanwhile", 1)).unwrap();
    });

    sync_on(&device, &server, &key).await.unwrap();

    assert_eq!(server.uploads.get(), 2);
    assert_eq!(received(&server, &key).await, vec!["before", "typed meanwhile"]);
}

#[tokio::test]
async fn a_sync_that_keeps_losing_gives_up_after_five_passes() {
    let (server, key) = (FakeServer::default(), data_key());
    let device = Device::new();
    device.folders.insert(folder("f1", "mine", 1)).unwrap();
    sync_on(&Device::new(), &server, &key).await.unwrap();
    server.always_beaten.set(true);

    let error = sync_on(&device, &server, &key).await.unwrap_err();

    assert_eq!(error.code(), "sync_kept_changing");
    assert_eq!(server.uploads.get(), 1 + MAX_PASSES as u32);
}

#[tokio::test]
async fn connections_the_sync_changed_are_reported() {
    let (server, key) = (FakeServer::default(), data_key());
    let other = Device::new();
    other.hold(connection("c1", "moved", 9));
    sync_on(&other, &server, &key).await.unwrap();
    let device = Device::new();
    device.hold(connection("c1", "prod", 1));

    let synced = sync_on(&device, &server, &key).await.unwrap();

    assert_eq!(synced.changed_connections, vec!["c1".to_string()]);
}

#[tokio::test]
async fn a_long_offline_device_keeps_its_data_when_the_server_holds_none() {
    let (server, key) = (FakeServer::default(), data_key());
    let device = Device::new();
    device.folders.insert(folder("f1", "kept", 1)).unwrap();
    device.state.inner.save(&SyncState { last_sync: Some(NOW - 100 * DAY), server: None }).unwrap();

    sync_on(&device, &server, &key).await.unwrap();

    assert_eq!(received(&server, &key).await, vec!["kept"]);
}

#[tokio::test]
async fn an_unreadable_kept_copy_is_downloaded_again() {
    let (server, key) = (FakeServer::default(), data_key());
    let device = Device::new();
    device.folders.insert(folder("f1", "first", 1)).unwrap();
    sync_on(&device, &server, &key).await.unwrap();
    let mut state = device.state.load();
    state.server.as_mut().unwrap().contents.blob = BASE64.encode(b"damaged");
    device.state.inner.save(&state).unwrap();
    device.folders.insert(folder("f2", "second", 1)).unwrap();

    sync_on(&device, &server, &key).await.unwrap();

    assert_eq!(server.full_downloads.get(), 1);
    assert_eq!(received(&server, &key).await, vec!["first", "second"]);
}

#[tokio::test]
async fn not_modified_without_a_kept_copy_downloads_in_full() {
    let (server, key) = (FakeServer::default(), data_key());
    let other = Device::new();
    other.folders.insert(folder("fo", "from elsewhere", 1)).unwrap();
    sync_on(&other, &server, &key).await.unwrap();
    let device = Device::new();
    device.folders.insert(folder("fm", "mine", 1)).unwrap();
    server.not_modified_once.set(true);

    sync_on(&device, &server, &key).await.unwrap();

    // One upload each: this device never mistook the server for an empty one.
    assert_eq!(server.uploads.get(), 2);
    assert_eq!(folder_names(&device), vec!["from elsewhere", "mine"]);
    assert_eq!(received(&server, &key).await, vec!["from elsewhere", "mine"]);
}

#[tokio::test]
async fn a_pass_that_leaves_a_store_alone_keeps_a_long_offline_device_stale() {
    let device = Device::new();
    let (server, key) = (FakeServer::default(), data_key());
    let other = Device::new();
    other.folders.insert(folder("fk", "kept", 1)).unwrap();
    sync_on(&other, &server, &key).await.unwrap();
    // Deleted elsewhere long ago; the server has forgotten the deletion.
    device.folders.insert(folder("fg", "gone", 1)).unwrap();
    device.state.inner.save(&SyncState { last_sync: Some(NOW - 100 * DAY), server: None }).unwrap();
    server.meanwhile(|_| {
        device.folders.insert(folder("fe", "typed meanwhile", 1)).unwrap();
    });

    sync_on(&device, &server, &key).await.unwrap();

    assert_eq!(received(&server, &key).await, vec!["kept"]);
}

/// Refuses its first write, as when the user dismisses one keychain prompt.
struct RefusesOnce<'a>(&'a FakeKeychain, Cell<bool>);

impl Keychain for RefusesOnce<'_> {
    fn read(&self, key: &str) -> Result<Option<Zeroizing<String>>, AppError> {
        self.0.read(key)
    }

    fn write(&self, key: &str, secret: &str) -> Result<(), AppError> {
        if self.1.replace(false) {
            return Err(AppError::Keychain("access denied".into()));
        }
        self.0.write(key, secret)
    }

    fn remove(&self, key: &str) -> Result<(), AppError> {
        self.0.remove(key)
    }
}

#[tokio::test]
async fn a_secret_a_later_pass_writes_is_not_reported_as_refused() {
    let device = Device::new();
    let (server, key) = (FakeServer::default(), data_key());
    let other = Device::new();
    other.hold(connection("c1", "prod", 9));
    other.keychain.write("c1", "from elsewhere").unwrap();
    sync_on(&other, &server, &key).await.unwrap();
    device.hold(connection("c1", "prod", 1));
    device.folders.insert(folder("f1", "mine", 1)).unwrap();
    server.meanwhile(|_| {
        device.folders.insert(folder("f2", "typed meanwhile", 1)).unwrap();
    });
    let keychain = RefusesOnce(&device.keychain, Cell::new(true));
    let stores = device.stores();
    let local = Local { stores: &stores, keychain: &keychain, state: &device.state };
    let keys = Keys { data_key: &key, wrapped_key: b"wrapped", recovery_wrapped_key: None };

    let synced = sync(&local, &server, &keys, NOW).await.unwrap();

    assert!(synced.keychain_error.is_none());
    assert_eq!(device.keychain.read("c1").unwrap().as_deref().map(String::as_str), Some("from elsewhere"));
}

#[tokio::test]
async fn a_sync_that_brings_another_devices_changes_says_so() {
    let (server, key) = (FakeServer::default(), data_key());
    let other = Device::new();
    other.folders.insert(folder("f.1", "from the öther device", 1)).unwrap();
    sync_on(&other, &server, &key).await.unwrap();

    let synced = sync_on(&Device::new(), &server, &key).await.unwrap();

    assert!(synced.changed);
}

#[tokio::test]
async fn a_sync_that_only_uploads_says_nothing_changed_here() {
    let (server, key) = (FakeServer::default(), data_key());
    let device = Device::new();
    device.folders.insert(folder("f.1", "only hére", 1)).unwrap();

    let synced = sync_on(&device, &server, &key).await.unwrap();

    assert!(!synced.changed);
}
