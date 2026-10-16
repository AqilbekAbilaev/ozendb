use crate::error::AppError;
use zeroize::Zeroizing;

const SERVICE: &str = "ozendb";

pub fn set(id: &str, password: &str) -> Result<(), AppError> {
    let entry = match keyring::Entry::new(SERVICE, id) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Keychain(e.to_string())),
    };
    match entry.set_password(password) {
        Ok(val) => Ok(val),
        Err(e) => Err(AppError::Keychain(e.to_string())),
    }
}

pub fn get(id: &str) -> Option<String> {
    let entry = match keyring::Entry::new(SERVICE, id) {
        Ok(entry) => entry,
        Err(_) => return None,
    };
    entry.get_password().ok()
}

pub fn delete(id: &str) {
    if let Ok(entry) = keyring::Entry::new(SERVICE, id) {
        let _ = entry.delete_credential();
    }
}

/// The keychain as sync reads and writes it. Unlike the functions above, a keychain
/// that can't be reached is an error rather than "nothing stored", so a locked
/// keychain can never pass for a connection without secrets. A trait so tests can
/// use a fake instead of the real keychain.
pub trait Keychain {
    /// `None` when nothing is stored under `key`.
    fn read(&self, key: &str) -> Result<Option<Zeroizing<String>>, AppError>;
    fn write(&self, key: &str, secret: &str) -> Result<(), AppError>;
    /// Succeeds when nothing was stored under `key`.
    fn remove(&self, key: &str) -> Result<(), AppError>;
}

pub struct OsKeychain;

impl Keychain for OsKeychain {
    fn read(&self, key: &str) -> Result<Option<Zeroizing<String>>, AppError> {
        match entry(key)?.get_password() {
            Ok(secret) => Ok(Some(Zeroizing::new(secret))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::Keychain(e.to_string())),
        }
    }

    fn write(&self, key: &str, secret: &str) -> Result<(), AppError> {
        set(key, secret)
    }

    fn remove(&self, key: &str) -> Result<(), AppError> {
        match entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Keychain(e.to_string())),
        }
    }
}

fn entry(key: &str) -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(SERVICE, key).map_err(|e| AppError::Keychain(e.to_string()))
}
