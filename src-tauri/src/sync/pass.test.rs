use super::*;
use crate::sync::state::SyncState;
use crate::sync::test_device::{connection, folder, Device};
use std::cell::{Cell, RefCell};

const DAY: i64 = 24 * 60 * 60 * 1000;
const NOW: i64 = 1_000 * DAY;

/// The server as the real one behaves: numbered versions, "not modified" for the version
/// a device names, and a refused upload when the version it replaces is no longer the
/// latest.
#[derive(Default)]
struct FakeServer<'a> {
    stored: RefCell<Option<ServerCopy>>,
    versions: Cell<u32>,
    full_downloads: Cell<u32>,
    uploads: Cell<u32>,
    offline: Cell<bool>,
    /// Another device always uploads first: the stored copy gets a new version as each
    /// upload arrives.
    always_beaten: Cell<bool>,
    /// Runs as the next upload arrives: what another device, or this one, does meanwhile.
    meanwhile: RefCell<Option<Box<dyn FnOnce(&FakeServer) + 'a>>>,
}

impl<'a> FakeServer<'a> {
    fn store(&self, contents: Contents) -> String {
        self.versions.set(self.versions.get() + 1);
        let version = format!("\"{}\"", self.versions.get());
        *self.stored.borrow_mut() = Some(ServerCopy { version: version.clone(), contents });
        version
    }

    fn version(&self) -> Option<String> {
        self.stored.borrow().as_ref().map(|copy| copy.version.clone())
    }

    fn meanwhile(&self, then: impl FnOnce(&FakeServer) + 'a) {
        *self.meanwhile.borrow_mut() = Some(Box::new(then));
    }
}

impl SyncServer for FakeServer<'_> {
    async fn download(&self, known: Option<&str>) -> Result<Download, AppError> {
        Ok(match self.stored.borrow().clone() {
            None => Download::Nothing,
            Some(copy) if Some(copy.version.as_str()) == known => Download::Unchanged,
            Some(copy) => {
                self.full_downloads.set(self.full_downloads.get() + 1);
                Download::Copy(copy)
            }
        })
    }

    async fn upload(&self, replacing: Option<&str>, contents: &Contents) -> Result<Option<String>, AppError> {
        self.uploads.set(self.uploads.get() + 1);
        let meanwhile = self.meanwhile.borrow_mut().take();
        if let Some(then) = meanwhile {
            then(self);
        }
        if self.always_beaten.get() {
            let contents = self.stored.borrow().clone().unwrap().contents;
            self.store(contents);
        }
        if self.offline.get() {
            return Err(AppError::Io(std::io::Error::other("offline")));
        }
        if self.version().as_deref() != replacing {
            return Ok(None);
        }
        Ok(Some(self.store(contents.clone())))
    }
}

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
