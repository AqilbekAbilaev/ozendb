//! One sync: download the server's copy, merge it with this device's, upload the result,
//! and only then save it on this device. Another device uploading first, or an edit made
//! here during the pass, starts the pass again, up to `MAX_PASSES` times.
use crate::error::AppError;
use crate::keychain::Keychain;
use crate::sync::crypto::DataKey;
use crate::sync::merge::Merge;
use crate::sync::snapshot::{Snapshot, SyncedStores, Written};
use crate::sync::state::{SyncState, SyncStateStorage};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};

pub const MAX_PASSES: usize = 5;

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

pub enum Download {
    /// The server holds nothing yet.
    Nothing,
    /// The server still holds the version this device named.
    Unchanged,
    Copy(ServerCopy),
}

/// The sync server's two calls. A trait so the pass can run against a fake.
// Whether the futures are `Send` is settled by the implementation the caller names.
#[allow(async_fn_in_trait)]
pub trait SyncServer {
    /// The server's copy, unless it is still version `known`.
    async fn download(&self, known: Option<&str>) -> Result<Download, AppError>;
    /// Stores `contents` in place of version `replacing` (`None`: the first upload) and
    /// returns the new version, or `None` when another device stored a newer one first.
    async fn upload(&self, replacing: Option<&str>, contents: &Contents) -> Result<Option<String>, AppError>;
}

/// The data key, and its wrapped copies to upload when the server holds nothing yet.
pub struct Keys<'a> {
    pub data_key: &'a DataKey,
    pub wrapped_key: &'a [u8],
    pub recovery_wrapped_key: Option<&'a [u8]>,
}

/// What a sync changed on this device that its caller must act on.
#[derive(Debug, Default)]
pub struct Synced {
    /// Connections whose record or secrets changed: drop their pooled clients.
    pub changed_connections: Vec<String>,
    /// A secret the keychain refused to change; the next sync writes it again.
    pub keychain_error: Option<AppError>,
}

impl Synced {
    fn add(&mut self, written: Written) {
        for id in written.changed_connections {
            if !self.changed_connections.contains(&id) {
                self.changed_connections.push(id);
            }
        }
        self.keychain_error = self.keychain_error.take().or(written.keychain_error);
    }
}

/// This device's side of a sync: what it reads from and writes to.
pub struct Local<'a, K: Keychain> {
    pub stores: &'a SyncedStores<'a>,
    pub keychain: &'a K,
    pub state: &'a SyncStateStorage,
}

pub async fn sync(local: &Local<'_, impl Keychain>, server: &impl SyncServer, keys: &Keys<'_>, now: i64) -> Result<Synced, AppError> {
    let mut synced = Synced::default();
    for _ in 0..MAX_PASSES {
        if pass(local, server, keys, now, &mut synced).await? {
            return Ok(synced);
        }
    }
    Err(AppError::SyncKeptChanging)
}

// One pass. False when it must run again: another device uploaded first, or a store here
// changed while it ran.
async fn pass(local: &Local<'_, impl Keychain>, server: &impl SyncServer, keys: &Keys<'_>, now: i64, synced: &mut Synced) -> Result<bool, AppError> {
    let state = local.state.load();
    let before = Snapshot::read(local.stores, local.keychain)?;
    let (copy, remote) = download(server, &state, keys.data_key).await?.unzip();
    let (merged, upload) = match remote {
        Some(remote) => {
            let merged = before.clone().merged(remote.clone(), &Merge::new(now, state.last_sync));
            let upload = !merged.same_as(&remote)?;
            (merged, upload)
        }
        // Nothing on the server to take this device's data's place, however long it was away.
        None => (before.clone().merged(Snapshot::default(), &Merge::new(now, None)), true),
    };
    let copy = match copy {
        Some(copy) if !upload => copy,
        copy => {
            let blob = BASE64.encode(keys.data_key.encrypt(&merged.encode()?)?);
            // The wrapped keys stay as the server holds them; only a first upload sends
            // this device's.
            let contents = match &copy {
                Some(copy) => Contents { blob, ..copy.contents.clone() },
                None => keys.contents(blob),
            };
            match server.upload(copy.as_ref().map(|copy| copy.version.as_str()), &contents).await? {
                Some(version) => ServerCopy { version, contents },
                None => return Ok(false),
            }
        }
    };
    // Only now that the server holds the result is it saved here.
    let written = merged.write_if_unchanged(&before, local.stores, local.keychain)?;
    let complete = written.complete;
    // A store left alone is not synced yet: keeping the old time keeps a long-offline
    // device's next pass from merging that store's records back in.
    let last_sync = if complete { Some(now) } else { state.last_sync };
    local.state.inner.save(&SyncState { last_sync, server: Some(copy) })?;
    synced.add(written);
    Ok(complete)
}

// The server's copy and what it holds. "Not modified" is answered from the copy kept
// here; when that copy is missing or no longer reads, the pass downloads in full.
async fn download(server: &impl SyncServer, state: &SyncState, data_key: &DataKey) -> Result<Option<(ServerCopy, Snapshot)>, AppError> {
    let mut answer = server.download(state.server.as_ref().map(|copy| copy.version.as_str())).await?;
    if let Download::Unchanged = answer {
        let kept = state.server.clone().and_then(|copy| decrypt(&copy.contents.blob, data_key).ok().map(|remote| (copy, remote)));
        if kept.is_some() {
            return Ok(kept);
        }
        answer = server.download(None).await?;
    }
    match answer {
        Download::Nothing => Ok(None),
        Download::Copy(copy) => {
            let remote = decrypt(&copy.contents.blob, data_key)?;
            Ok(Some((copy, remote)))
        }
        // Named no version, so "not modified" can't be about one this device knows.
        Download::Unchanged => Err(AppError::UnreadableSyncData),
    }
}

fn decrypt(blob: &str, data_key: &DataKey) -> Result<Snapshot, AppError> {
    let sealed = BASE64.decode(blob).map_err(|_| AppError::UnreadableSyncData)?;
    Snapshot::decode(&data_key.decrypt(&sealed)?)
}

impl Keys<'_> {
    // What a first upload sends: `blob` with this device's wrapped keys.
    fn contents(&self, blob: String) -> Contents {
        Contents {
            blob,
            wrapped_key: BASE64.encode(self.wrapped_key),
            recovery_wrapped_key: self.recovery_wrapped_key.map(|key| BASE64.encode(key)),
        }
    }
}

#[cfg(test)]
#[path = "pass.test.rs"]
mod tests;
