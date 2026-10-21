//! A sync server in memory for sync tests, behaving as the real one does.
use crate::error::AppError;
use crate::sync::pass::{Download, SyncServer};
use crate::sync::state::{Contents, ServerCopy};
use std::cell::{Cell, RefCell};

/// The server as the real one behaves: numbered versions, "not modified" for the version
/// a device names, and a refused upload when the version it replaces is no longer the
/// latest.
#[derive(Default)]
pub(crate) struct FakeServer<'a> {
    pub(crate) stored: RefCell<Option<ServerCopy>>,
    pub(crate) versions: Cell<u32>,
    pub(crate) full_downloads: Cell<u32>,
    pub(crate) uploads: Cell<u32>,
    pub(crate) offline: Cell<bool>,
    /// The account's Premium has lapsed: downloads still work, uploads are refused.
    pub(crate) lapsed: Cell<bool>,
    /// Another device always uploads first: the stored copy gets a new version as each
    /// upload arrives.
    pub(crate) always_beaten: Cell<bool>,
    /// The next download answers "not modified" whatever version it names, as a cache in
    /// between might.
    pub(crate) not_modified_once: Cell<bool>,
    /// Runs as the next upload arrives: what another device, or this one, does meanwhile.
    pub(crate) meanwhile: RefCell<Option<Box<dyn FnOnce(&FakeServer) + 'a>>>,
}

impl<'a> FakeServer<'a> {
    pub(crate) fn store(&self, contents: Contents) -> String {
        self.versions.set(self.versions.get() + 1);
        let version = format!("\"{}\"", self.versions.get());
        *self.stored.borrow_mut() = Some(ServerCopy { version: version.clone(), contents });
        version
    }

    pub(crate) fn version(&self) -> Option<String> {
        self.stored.borrow().as_ref().map(|copy| copy.version.clone())
    }

    pub(crate) fn meanwhile(&self, then: impl FnOnce(&FakeServer) + 'a) {
        *self.meanwhile.borrow_mut() = Some(Box::new(then));
    }
}

impl SyncServer for FakeServer<'_> {
    async fn download(&self, known: Option<&str>) -> Result<Download, AppError> {
        if self.not_modified_once.replace(false) {
            return Ok(Download::Unchanged);
        }
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
        if self.lapsed.get() {
            return Err(AppError::NotPremium);
        }
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
