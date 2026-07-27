// Generic mechanics shared by every JSON-backed store.
//
// Each domain store (folders, saved queries, history, …) used to hand-roll the
// same skeleton: a `path` plus a `Mutex<()>`, a `load` that reads via
// `persist::read_json` and falls back to a default, a private `save` that
// serializes + `persist::atomic_write`s, and mutation methods shaped as
// *lock → load → mutate → save* with the same poison-tolerant lock idiom. That
// skeleton lives here once; a store keeps only its bespoke methods and delegates
// the storage mechanics to a `JsonStore<T>`.

use crate::error::AppError;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::marker::PhantomData;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct JsonStore<T> {
    path: PathBuf,
    // Serializes read-modify-write so two concurrent updates can't lose each
    // other's changes.
    lock: Mutex<()>,
    // `T` appears only in the method signatures, never in a field, so the struct
    // needs a marker to be generic over it. `fn() -> T` keeps `JsonStore<T>`
    // `Send`/`Sync` regardless of `T` (it carries no `T` value).
    marker: PhantomData<fn() -> T>,
}

impl<T> JsonStore<T>
where
    T: Serialize + DeserializeOwned + Default,
{
    pub fn new(path: PathBuf) -> Self {
        Self { path: path, lock: Mutex::new(()), marker: PhantomData }
    }

    // Snapshot read — no lock. `atomic_write` swaps the whole file with a rename,
    // so a reader sees either the old or the new complete file, never a partial
    // one. Missing file -> default; a present-but-corrupt file is quarantined
    // aside (not silently emptied) so the next save can't overwrite it. See
    // persist::read_json.
    pub fn load(&self) -> T {
        match crate::persist::read_json(&self.path) {
            Some(value) => value,
            None => T::default(),
        }
    }

    // Replace the whole value under the lock.
    pub fn save(&self, value: &T) -> Result<(), AppError> {
        let _guard = self.guard();
        self.write(value)
    }

    // The read-modify-write core every mutation method funnels through: lock,
    // load, apply `mutate`, persist. Returns the closure's own return value so a
    // caller can, e.g., report whether anything changed.
    pub fn update<R>(&self, mutate: impl FnOnce(&mut T) -> R) -> Result<R, AppError> {
        let _guard = self.guard();
        let mut value: T = match crate::persist::read_json(&self.path) {
            Some(value) => value,
            None => T::default(),
        };
        let result = mutate(&mut value);
        match self.write(&value) {
            Ok(()) => Ok(result),
            Err(e) => Err(e),
        }
    }

    fn write(&self, value: &T) -> Result<(), AppError> {
        let content = match serde_json::to_string_pretty(value) {
            Ok(val) => val,
            Err(e) => return Err(AppError::Serde(e)),
        };
        crate::persist::atomic_write(&self.path, &content)
    }

    fn guard(&self) -> std::sync::MutexGuard<'_, ()> {
        match self.lock.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        }
    }
}

/// Generate the struct, constructor, and `load` delegation for a domain store
/// that wraps `JsonStore<T>`. Every store gets `new(path)`, `load()`, and a
/// `pub(crate)` `inner` field so custom mutation methods can call
/// `self.inner.update(...)` directly.
///
/// # Example
///
/// ```ignore
/// crate::json_store_wrapper!(SettingsStorage, Settings);
///
/// impl SettingsStorage {
///     pub fn save(&self, settings: &Settings) -> Result<(), AppError> {
///         self.inner.save(settings)
///     }
/// }
/// ```
#[macro_export]
macro_rules! json_store_wrapper {
    ($name:ident, $type:ty) => {
        pub struct $name {
            pub(crate) inner: crate::json_store::JsonStore<$type>,
        }
        impl $name {
            pub fn new(path: std::path::PathBuf) -> Self {
                Self { inner: crate::json_store::JsonStore::new(path) }
            }
            pub fn load(&self) -> $type {
                self.inner.load()
            }
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::tempdir;

    // Returns the first `*.corrupt-*` sibling in `dir`, if any.
    fn find_corrupt_backup(dir: &Path) -> Option<PathBuf> {
        for entry in std::fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            if file_name.contains(".corrupt-") {
                return Some(entry.path());
            }
        }
        None
    }

    #[test]
    fn save_then_load_roundtrips() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("data.json");
        let store: JsonStore<Vec<String>> = JsonStore::new(path);
        let value = vec![String::from("a"), String::from("b")];
        store.save(&value).unwrap();
        assert_eq!(store.load(), value);
    }

    #[test]
    fn update_mutates_and_persists() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("data.json");
        let store: JsonStore<Vec<String>> = JsonStore::new(path);
        store.update(|list| list.push(String::from("first"))).unwrap();
        // The closure's return value is propagated back to the caller.
        let len = store.update(|list| {
            list.push(String::from("second"));
            list.len()
        }).unwrap();
        assert_eq!(len, 2);
        // ...and the change is on disk, visible to a fresh load.
        assert_eq!(
            store.load(),
            vec![String::from("first"), String::from("second")]
        );
    }

    #[test]
    fn load_missing_file_returns_default() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("data.json");
        let store: JsonStore<Vec<String>> = JsonStore::new(path);
        assert_eq!(store.load(), Vec::<String>::new());
    }

    #[test]
    fn load_corrupt_file_returns_default_and_quarantines() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("data.json");
        std::fs::write(&path, "not valid json {{").unwrap();
        let store: JsonStore<Vec<String>> = JsonStore::new(path.clone());
        // Corrupt -> default (delegated to the already-tested read_json)...
        assert_eq!(store.load(), Vec::<String>::new());
        // ...and the corrupt file is moved aside, not left at the target path.
        assert!(!path.exists());
        assert!(find_corrupt_backup(dir.path()).is_some());
    }
}
