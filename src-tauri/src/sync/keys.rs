//! The keys this device syncs with, kept once the first sync sets them up (#326) so later
//! syncs run without asking for the password. The data key lives in the keychain; its two
//! wrapped copies, which only a first upload sends, live in a device file, since the
//! password and the recovery key already protect them. Device state: it never syncs, and
//! signing out forgets it.
use crate::error::AppError;
use crate::json_store_wrapper;
use crate::keychain::Keychain;
use crate::sync::crypto::DataKey;
use crate::sync::pass::Keys;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};

pub const DATA_KEY: &str = "sync::data-key";

/// The wrapped copies of the data key, as base64 text.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Wrapped {
    wrapped_key: String,
    recovery_wrapped_key: Option<String>,
}

/// The data key, unlocked, and its wrapped copies.
pub struct SyncKeys {
    data_key: DataKey,
    wrapped_key: Vec<u8>,
    recovery_wrapped_key: Option<Vec<u8>>,
}

impl SyncKeys {
    pub fn new(data_key: DataKey, wrapped_key: Vec<u8>, recovery_wrapped_key: Option<Vec<u8>>) -> Self {
        Self { data_key, wrapped_key, recovery_wrapped_key }
    }

    /// The same data key with other wrapped copies of it.
    pub fn relocked(self, wrapped_key: Vec<u8>, recovery_wrapped_key: Option<Vec<u8>>) -> Self {
        Self { wrapped_key, recovery_wrapped_key, ..self }
    }

    /// The keys as a sync pass takes them.
    pub fn keys(&self) -> Keys<'_> {
        Keys { data_key: &self.data_key, wrapped_key: &self.wrapped_key, recovery_wrapped_key: self.recovery_wrapped_key.as_deref() }
    }
}

json_store_wrapper!(SyncKeysStorage, Option<Wrapped>);

impl SyncKeysStorage {
    /// The kept keys; `None` until sync is set up on this device. A keychain that can't
    /// be read is an error, so a locked one never passes for "not set up".
    pub fn keys(&self, keychain: &impl Keychain) -> Result<Option<SyncKeys>, AppError> {
        let Some(wrapped) = self.load() else {
            return Ok(None);
        };
        let Some(text) = keychain.read(DATA_KEY)? else {
            return Ok(None);
        };
        let decode = |text: &str| BASE64.decode(text).map_err(|_| AppError::Crypto("The kept wrapped sync key is damaged.".into()));
        Ok(Some(SyncKeys {
            data_key: DataKey::from_text(&text)?,
            wrapped_key: decode(&wrapped.wrapped_key)?,
            recovery_wrapped_key: wrapped.recovery_wrapped_key.as_deref().map(decode).transpose()?,
        }))
    }

    pub fn save(&self, keychain: &impl Keychain, keys: &SyncKeys) -> Result<(), AppError> {
        keychain.write(DATA_KEY, &keys.data_key.to_text())?;
        self.inner.save(&Some(Wrapped {
            wrapped_key: BASE64.encode(&keys.wrapped_key),
            recovery_wrapped_key: keys.recovery_wrapped_key.as_ref().map(|key| BASE64.encode(key)),
        }))
    }

    /// Forgets both halves. The file is cleared even when the keychain refuses, so the
    /// keys no longer count as set up; the keychain's error is still returned.
    pub fn forget(&self, keychain: &impl Keychain) -> Result<(), AppError> {
        let removed = keychain.remove(DATA_KEY);
        self.inner.save(&None)?;
        removed
    }
}

#[cfg(test)]
#[path = "keys.test.rs"]
mod tests;
