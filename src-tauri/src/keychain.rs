use crate::error::AppError;
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use zeroize::Zeroizing;

const SERVICE: &str = "ozendb";

pub fn set(id: &str, password: &str) -> Result<(), AppError> {
    let entry = match keyring::Entry::new(SERVICE, id) {
        Ok(val) => val,
        Err(e) => return Err(failure(e)),
    };
    match entry.set_password(password) {
        Ok(val) => Ok(val),
        Err(e) => Err(failure(e)),
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
            Err(e) => Err(failure(e)),
        }
    }

    fn write(&self, key: &str, secret: &str) -> Result<(), AppError> {
        set(key, secret)
    }

    fn remove(&self, key: &str) -> Result<(), AppError> {
        match entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(failure(e)),
        }
    }
}

fn entry(key: &str) -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(SERVICE, key).map_err(failure)
}

// A platform failure is what keyring reports when there is no keyring service at all:
// no D-Bus session, or none providing org.freedesktop.secrets (tried on 2026-10-22). A
// locked or refused keychain reports something else and stays a plain keychain error.
fn failure(e: keyring::Error) -> AppError {
    match e {
        keyring::Error::PlatformFailure(_) => AppError::KeychainUnavailable(e.to_string()),
        e => AppError::Keychain(e.to_string()),
    }
}

/// Where the account's sign-in session and sync key are kept: the system keychain, or,
/// on a system without a keyring service, memory until the app quits. Then the user signs
/// in and unlocks sync again on each launch, and nothing secret is written to disk.
pub struct AccountKeychain<K: Keychain> {
    system: K,
    memory: Mutex<HashMap<String, Zeroizing<String>>>,
}

impl<K: Keychain> AccountKeychain<K> {
    pub fn new(system: K) -> Self {
        Self { system, memory: Mutex::default() }
    }

    fn memory(&self) -> MutexGuard<'_, HashMap<String, Zeroizing<String>>> {
        self.memory.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[cfg(test)]
    fn inner(&self) -> &K {
        &self.system
    }
}

impl<K: Keychain> Keychain for AccountKeychain<K> {
    fn read(&self, key: &str) -> Result<Option<Zeroizing<String>>, AppError> {
        match self.system.read(key) {
            Err(AppError::KeychainUnavailable(_)) => Ok(self.memory().get(key).cloned()),
            read => read,
        }
    }

    fn write(&self, key: &str, secret: &str) -> Result<(), AppError> {
        match self.system.write(key, secret) {
            Err(AppError::KeychainUnavailable(_)) => {
                self.memory().insert(key.to_string(), Zeroizing::new(secret.to_string()));
                Ok(())
            }
            written => written,
        }
    }

    fn remove(&self, key: &str) -> Result<(), AppError> {
        self.memory().remove(key);
        match self.system.remove(key) {
            Err(AppError::KeychainUnavailable(_)) => Ok(()),
            removed => removed,
        }
    }
}

#[cfg(test)]
pub(crate) mod fake {
    use super::Keychain;
    use crate::error::AppError;
    use std::cell::RefCell;
    use std::collections::HashMap;
    use zeroize::Zeroizing;

    /// The keychain as a map, so no test touches the real one.
    #[derive(Default)]
    pub struct FakeKeychain(RefCell<HashMap<String, String>>);

    impl FakeKeychain {
        pub fn holding(entries: &[(&str, &str)]) -> Self {
            let keychain = FakeKeychain::default();
            for (key, secret) in entries {
                keychain.0.borrow_mut().insert(key.to_string(), secret.to_string());
            }
            keychain
        }

        pub fn entries(&self) -> HashMap<String, String> {
            self.0.borrow().clone()
        }
    }

    /// A `FakeKeychain` that refuses to change one key, as when the user denies access to one item.
    pub struct RefusingKeychain(pub FakeKeychain, pub &'static str);

    impl RefusingKeychain {
        fn check(&self, key: &str) -> Result<(), AppError> {
            if key == self.1 { Err(AppError::Keychain("access denied".into())) } else { Ok(()) }
        }
    }

    impl Keychain for RefusingKeychain {
        fn read(&self, key: &str) -> Result<Option<Zeroizing<String>>, AppError> {
            self.0.read(key)
        }

        fn write(&self, key: &str, secret: &str) -> Result<(), AppError> {
            self.check(key)?;
            self.0.write(key, secret)
        }

        fn remove(&self, key: &str) -> Result<(), AppError> {
            self.check(key)?;
            self.0.remove(key)
        }
    }

    impl Keychain for FakeKeychain {
        fn read(&self, key: &str) -> Result<Option<Zeroizing<String>>, AppError> {
            Ok(self.0.borrow().get(key).cloned().map(Zeroizing::new))
        }

        fn write(&self, key: &str, secret: &str) -> Result<(), AppError> {
            self.0.borrow_mut().insert(key.to_string(), secret.to_string());
            Ok(())
        }

        fn remove(&self, key: &str) -> Result<(), AppError> {
            self.0.borrow_mut().remove(key);
            Ok(())
        }
    }

    /// A system without a keyring service, as a Linux desktop without one is.
    pub struct UnavailableKeychain;

    impl Keychain for UnavailableKeychain {
        fn read(&self, _: &str) -> Result<Option<Zeroizing<String>>, AppError> {
            Err(AppError::KeychainUnavailable("no keyring service".into()))
        }

        fn write(&self, _: &str, _: &str) -> Result<(), AppError> {
            Err(AppError::KeychainUnavailable("no keyring service".into()))
        }

        fn remove(&self, _: &str) -> Result<(), AppError> {
            Err(AppError::KeychainUnavailable("no keyring service".into()))
        }
    }

    /// A keychain that is locked or unreachable.
    pub struct LockedKeychain;

    impl Keychain for LockedKeychain {
        fn read(&self, _: &str) -> Result<Option<Zeroizing<String>>, AppError> {
            Err(AppError::Keychain("The keychain is locked.".into()))
        }

        fn write(&self, _: &str, _: &str) -> Result<(), AppError> {
            Err(AppError::Keychain("The keychain is locked.".into()))
        }

        fn remove(&self, _: &str) -> Result<(), AppError> {
            Err(AppError::Keychain("The keychain is locked.".into()))
        }
    }
}

#[cfg(test)]
#[path = "keychain.test.rs"]
mod tests;
