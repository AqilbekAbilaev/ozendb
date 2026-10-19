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
