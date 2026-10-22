use super::*;
use crate::keychain::fake::FakeKeychain;
use crate::storage::HostEntry;
use tempfile::tempdir;

fn conn(id: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: id.into(),
        name: String::from("Prod ü/db"),
        hosts: vec![HostEntry { host: String::from("db.example"), port: 27017 }],
        username: Some(String::from("admin")),
        ..Default::default()
    }
}

fn new_password() -> Secrets {
    (Some(String::from("n3w pässword")), None, None)
}

#[test]
fn a_saved_edit_writes_the_new_password() {
    let dir = tempdir().unwrap();
    let storage = Storage::new(dir.path().join("connections.json"));
    storage.add(conn("c.1")).unwrap();
    let keychain = FakeKeychain::holding(&[("c.1", "old")]);

    save_edit(&storage, &keychain, &conn("c.1"), new_password()).unwrap();

    assert_eq!(keychain.entries().get("c.1").map(String::as_str), Some("n3w pässword"));
}

#[test]
fn a_failed_save_leaves_the_old_password() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempdir().unwrap();
    let storage = Storage::new(dir.path().join("connections.json"));
    storage.add(conn("c.1")).unwrap();
    let keychain = FakeKeychain::holding(&[("c.1", "old")]);
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o555)).unwrap();

    let saved = save_edit(&storage, &keychain, &conn("c.1"), new_password());

    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(saved.is_err());
    assert_eq!(keychain.entries().get("c.1").map(String::as_str), Some("old"));
}

#[test]
fn an_edit_of_a_deleted_connection_writes_no_secret() {
    let dir = tempdir().unwrap();
    let storage = Storage::new(dir.path().join("connections.json"));
    storage.add(conn("c.1")).unwrap();
    storage.remove("c.1").unwrap();
    let keychain = FakeKeychain::default();

    let saved = save_edit(&storage, &keychain, &conn("c.1"), new_password());

    assert!(saved.is_err());
    assert!(keychain.entries().is_empty());
}
