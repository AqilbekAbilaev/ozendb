use super::*;
use crate::keychain::fake::{FakeKeychain, LockedKeychain};
use tempfile::TempDir;

const BLOB: &[u8] = "{\"conn/1 é\": \"pa ss.wörd\"}".as_bytes();

fn storage() -> (TempDir, SyncKeysStorage) {
    let dir = tempfile::tempdir().unwrap();
    let storage = SyncKeysStorage::new(dir.path().join("sync keys ü.json"));
    (dir, storage)
}

fn kept(storage: &SyncKeysStorage, keychain: &FakeKeychain) -> Vec<u8> {
    let data_key = DataKey::generate().unwrap();
    let sealed = data_key.encrypt(BLOB).unwrap();
    storage.save(keychain, &SyncKeys::new(data_key, vec![1, 2, 3], Some(vec![4, 5]))).unwrap();
    sealed
}

#[test]
fn saved_keys_load_back_with_the_same_data_key_and_wrapped_copies() {
    let (_dir, storage) = storage();
    let keychain = FakeKeychain::default();
    let sealed = kept(&storage, &keychain);
    let loaded = storage.keys(&keychain).unwrap().unwrap();
    let keys = loaded.keys();
    assert_eq!(keys.data_key.decrypt(&sealed).unwrap().as_slice(), BLOB);
    assert_eq!(keys.wrapped_key, &[1, 2, 3]);
    assert_eq!(keys.recovery_wrapped_key, Some(&[4u8, 5][..]));
}

#[test]
fn nothing_saved_is_not_set_up() {
    let (_dir, storage) = storage();
    assert!(storage.keys(&FakeKeychain::default()).unwrap().is_none());
}

#[test]
fn wrapped_copies_without_the_data_key_are_not_set_up() {
    let (_dir, storage) = storage();
    let keychain = FakeKeychain::default();
    kept(&storage, &keychain);
    keychain.remove(DATA_KEY).unwrap();
    assert!(storage.keys(&keychain).unwrap().is_none());
}

#[test]
fn a_locked_keychain_is_an_error_rather_than_not_set_up() {
    let (_dir, storage) = storage();
    kept(&storage, &FakeKeychain::default());
    assert!(matches!(storage.keys(&LockedKeychain), Err(AppError::Keychain(_))));
}

#[test]
fn forgotten_keys_are_gone_from_the_keychain_and_the_file() {
    let (_dir, storage) = storage();
    let keychain = FakeKeychain::default();
    kept(&storage, &keychain);
    storage.forget(&keychain).unwrap();
    assert!(keychain.entries().is_empty());
    assert!(storage.load().is_none());
}

#[test]
fn a_keychain_that_refuses_to_forget_still_leaves_the_keys_not_set_up() {
    let (_dir, storage) = storage();
    kept(&storage, &FakeKeychain::default());
    assert!(storage.forget(&LockedKeychain).is_err());
    assert!(storage.load().is_none());
}
