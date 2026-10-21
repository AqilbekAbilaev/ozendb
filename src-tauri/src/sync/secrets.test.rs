use super::SyncedConnection;
use crate::error::AppError;
use crate::keychain::fake::{FakeKeychain, LockedKeychain};
use crate::record::{Record, Stamp};
use crate::storage::ConnectionConfig;

const ID: &str = "prod db/ä.1";

fn every_secret() -> [(String, &'static str); 3] {
    [
        (ID.to_string(), "pä55 wörd"),
        (format!("{ID}::ssh-pass"), "ssh \"hunter2\""),
        (format!("{ID}::ssh-key-pass"), "key/pass.phrase"),
    ]
}

/// A piece of each secret above that no escaping changes, to search output for.
const MARKERS: [&str; 3] = ["pä55", "hunter2", "pass.phrase"];

fn keychain_with_every_secret() -> FakeKeychain {
    let secrets = every_secret();
    FakeKeychain::holding(&secrets.iter().map(|(k, v)| (k.as_str(), *v)).collect::<Vec<_>>())
}

fn connection(deleted: bool) -> ConnectionConfig {
    ConnectionConfig {
        id: ID.to_string(),
        name: "Prod, primary".to_string(),
        stamp: Stamp { updated_at: 42, deleted, ..Stamp::default() },
        ..ConnectionConfig::default()
    }
}

fn travelled(synced: &SyncedConnection) -> SyncedConnection {
    serde_json::from_str(&serde_json::to_string(synced).unwrap()).unwrap()
}

#[test]
fn every_secret_reaches_another_device() {
    let synced = SyncedConnection::collect(connection(false), &keychain_with_every_secret()).unwrap();
    let elsewhere = FakeKeychain::default();
    travelled(&synced).save_secrets(&elsewhere).unwrap();
    assert_eq!(elsewhere.entries(), keychain_with_every_secret().entries());
}

#[test]
fn the_connection_record_travels_unchanged() {
    let synced = SyncedConnection::collect(connection(false), &keychain_with_every_secret()).unwrap();
    assert_eq!(travelled(&synced).into_config(), connection(false));
}

#[test]
fn a_connection_without_secrets_travels_with_none() {
    let synced = SyncedConnection::collect(connection(false), &FakeKeychain::default()).unwrap();
    let elsewhere = FakeKeychain::default();
    travelled(&synced).save_secrets(&elsewhere).unwrap();
    assert!(elsewhere.entries().is_empty());
}

#[test]
fn a_secret_the_winning_device_no_longer_holds_is_removed() {
    let only_password = FakeKeychain::holding(&[(ID, "pä55 wörd")]);
    let synced = SyncedConnection::collect(connection(false), &only_password).unwrap();
    let elsewhere = keychain_with_every_secret();
    travelled(&synced).save_secrets(&elsewhere).unwrap();
    assert_eq!(elsewhere.entries(), only_password.entries());
}

#[test]
fn a_deleted_connection_carries_no_secrets() {
    let synced = SyncedConnection::collect(connection(true), &keychain_with_every_secret()).unwrap();
    let json = serde_json::to_string(&synced).unwrap();
    for marker in MARKERS {
        assert!(!json.contains(marker), "{marker} leaked into {json}");
    }
}

#[test]
fn a_deleted_connection_removes_the_secrets_held_here() {
    let synced = SyncedConnection::collect(connection(true), &FakeKeychain::default()).unwrap();
    let here = keychain_with_every_secret();
    travelled(&synced).save_secrets(&here).unwrap();
    assert!(here.entries().is_empty());
}

#[test]
fn deleting_the_record_drops_its_secrets() {
    let synced = SyncedConnection::collect(connection(false), &keychain_with_every_secret()).unwrap();
    let here = keychain_with_every_secret();
    synced.emptied().save_secrets(&here).unwrap();
    assert!(here.entries().is_empty());
}

#[test]
fn a_keychain_that_cannot_be_read_is_not_mistaken_for_no_secrets() {
    let result = SyncedConnection::collect(connection(false), &LockedKeychain);
    assert!(matches!(result, Err(AppError::Keychain(_))));
}

#[test]
fn debug_output_hides_every_secret() {
    let synced = SyncedConnection::collect(connection(false), &keychain_with_every_secret()).unwrap();
    let debug = format!("{synced:?}");
    for marker in MARKERS {
        assert!(!debug.contains(marker), "{marker} leaked into {debug}");
    }
}

#[test]
fn the_record_keeps_its_connection_id_and_stamp() {
    let synced = SyncedConnection::collect(connection(false), &FakeKeychain::default()).unwrap();
    assert_eq!(synced.id(), ID);
    assert_eq!(crate::record::Stamped::stamp(&synced), &Stamp { updated_at: 42, deleted: false, ..Stamp::default() });
}
