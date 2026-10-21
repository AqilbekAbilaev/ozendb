//! Setting sync up on this device (#326). On an account's first device the user chooses
//! a sync password and is shown a recovery key; on any later one they unlock the key the
//! server already holds with either of them.
use crate::error::AppError;
use crate::keychain::Keychain;
use crate::sync::crypto::DataKey;
use crate::sync::keys::SyncKeys;
use crate::sync::pass::{sync, Download, Local, SyncServer, Synced};
use crate::sync::recovery::RecoveryKey;
use crate::sync::state::Contents;
use argon2::Params;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::Serialize;
use std::sync::Mutex;
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

pub const MIN_PASSWORD_CHARS: usize = 12;
pub const MAX_PASSWORD_CHARS: usize = 256;

/// Sent to the frontend as `{ "state": "set_up" }`, `{ "state": "new" }` or
/// `{ "state": "existing", "recovery": true }`.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SetupStatus {
    /// This device already holds the keys.
    SetUp,
    /// The server holds nothing yet: this is the account's first device.
    New,
    /// Another device set sync up; `recovery` says whether a recovery key can unlock it.
    Existing { recovery: bool },
}

/// What the user unlocks the server's keys with.
pub enum Secret {
    Password(Zeroizing<String>),
    RecoveryKey(Zeroizing<String>),
}

/// The wrapped copies of the data key the server holds.
pub struct ServerKeys {
    wrapped_key: Vec<u8>,
    recovery_wrapped_key: Option<Vec<u8>>,
}

impl ServerKeys {
    /// The server's wrapped keys; `None` when it holds nothing yet.
    pub async fn fetch(server: &impl SyncServer) -> Result<Option<Self>, AppError> {
        match server.download(None).await? {
            Download::Nothing => Ok(None),
            Download::Copy(copy) => Ok(Some(Self::decode(&copy.contents)?)),
            // Named no version, so "not modified" can't be about one this device knows.
            Download::Unchanged => Err(AppError::UnreadableSyncData),
        }
    }

    /// The keys, unlocked with `secret`. They keep the server's wrapped copies, so this
    /// device uploads the same ones should the server ever hold nothing again.
    pub fn unlock(self, secret: &Secret) -> Result<SyncKeys, AppError> {
        let data_key = match secret {
            Secret::Password(password) => DataKey::unwrap_with(&self.wrapped_key, password)?,
            Secret::RecoveryKey(typed) => {
                let wrapped = self.recovery_wrapped_key.as_deref().ok_or_else(|| {
                    AppError::Validation("This account has no recovery key. Enter its sync password instead.".into())
                })?;
                DataKey::unwrap_with_recovery(wrapped, &RecoveryKey::parse(typed)?)?
            }
        };
        Ok(SyncKeys::new(data_key, self.wrapped_key, self.recovery_wrapped_key))
    }

    // Whether these are the wrapped keys `keys` carries, as on the device that made them.
    fn same_as(&self, keys: &SyncKeys) -> bool {
        self.wrapped_key == keys.keys().wrapped_key
    }

    fn decode(contents: &Contents) -> Result<Self, AppError> {
        let decode = |text: &str| BASE64.decode(text).map_err(|_| AppError::UnreadableSyncData);
        Ok(Self {
            wrapped_key: decode(&contents.wrapped_key)?,
            recovery_wrapped_key: contents.recovery_wrapped_key.as_deref().map(decode).transpose()?,
        })
    }
}

/// How far sync is set up for the account, as the server tells it.
pub async fn server_status(server: &impl SyncServer) -> Result<SetupStatus, AppError> {
    Ok(match ServerKeys::fetch(server).await? {
        None => SetupStatus::New,
        Some(held) => SetupStatus::Existing { recovery: held.recovery_wrapped_key.is_some() },
    })
}

/// Refuses a sync password shorter than `MIN_PASSWORD_CHARS` or longer than
/// `MAX_PASSWORD_CHARS`, counted as the key derivation reads it (NFC).
pub fn check_password(password: &str) -> Result<(), AppError> {
    let length = password.nfc().count();
    if length < MIN_PASSWORD_CHARS {
        return Err(AppError::Validation(format!("A sync password needs at least {MIN_PASSWORD_CHARS} characters.")));
    }
    if length > MAX_PASSWORD_CHARS {
        return Err(AppError::Validation(format!("A sync password can have at most {MAX_PASSWORD_CHARS} characters.")));
    }
    Ok(())
}

/// New keys for an account's first device: a data key wrapped by `password` and by a new
/// recovery key, which is returned as text to show the user once.
pub fn create(password: &str, params: &Params) -> Result<(SyncKeys, Zeroizing<String>), AppError> {
    check_password(password)?;
    let (data_key, recovery) = (DataKey::generate()?, RecoveryKey::generate()?);
    let wrapped_key = data_key.wrap(password, params)?;
    let recovery_wrapped_key = data_key.wrap_for_recovery(&recovery)?;
    Ok((SyncKeys::new(data_key, wrapped_key, Some(recovery_wrapped_key)), recovery.display()))
}

/// The first sync of an account's first device, which uploads its data with `keys`. It
/// fails when the upload was refused for want of Premium, or when another device set
/// sync up meanwhile, whose keys this device must then unlock instead.
pub async fn first_upload(local: &Local<'_, impl Keychain>, server: &impl SyncServer, keys: &SyncKeys, now: i64) -> Result<Synced, AppError> {
    match sync(local, server, &keys.keys(), now).await {
        // Nothing was downloaded, so nothing was saved here either.
        Ok(synced) if synced.received_only => Err(AppError::NotPremium),
        Ok(synced) => Ok(synced),
        // Another device's copy can't be decrypted with these keys, so the pass fails
        // before it uploads anything; its wrapped keys tell the two failures apart.
        Err(error) => match ServerKeys::fetch(server).await {
            Ok(Some(held)) if !held.same_as(keys) => Err(AppError::SyncSetUpElsewhere),
            _ => Err(error),
        },
    }
}

/// The keys made by the first step of a first device's setup, held in memory until the
/// user has saved the recovery key and the first upload has gone through.
#[derive(Default)]
pub struct PendingSetup(Mutex<Option<Pending>>);

struct Pending {
    session: Zeroizing<String>,
    keys: SyncKeys,
}

impl PendingSetup {
    /// Holds `keys`, made while signed in with `session`, in place of any held before.
    pub fn hold(&self, session: Zeroizing<String>, keys: SyncKeys) {
        *self.lock() = Some(Pending { session, keys });
    }

    /// Takes the held keys if they were made under `session`. Keys made under another
    /// session are dropped, so a sign-out never hands them to the next account.
    pub fn take(&self, session: &str) -> Option<SyncKeys> {
        self.lock().take().filter(|pending| pending.session.as_str() == session).map(|pending| pending.keys)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<Pending>> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
#[path = "setup.test.rs"]
mod tests;
