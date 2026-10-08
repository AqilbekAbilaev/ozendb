use super::*;
use tempfile::tempdir;

fn storage_with(read_only: bool) -> (Storage, tempfile::TempDir) {
    let dir = tempdir().unwrap();
    let storage = Storage::new(dir.path().join("connections.json"));
    storage
        .add(ConnectionConfig { id: "c1".into(), name: "Prod".into(), read_only, ..Default::default() })
        .unwrap();
    (storage, dir)
}

#[test]
fn reads_and_writes_resolve_on_a_writable_connection() {
    let (storage, _dir) = storage_with(false);
    assert_eq!(config_for(&storage, "c1", Access::Read).unwrap().id, "c1");
    assert_eq!(config_for(&storage, "c1", Access::Write).unwrap().id, "c1");
}

#[test]
fn a_read_only_connection_refuses_writes_but_not_reads() {
    let (storage, _dir) = storage_with(true);
    assert!(config_for(&storage, "c1", Access::Read).is_ok());
    match config_for(&storage, "c1", Access::Write) {
        Err(AppError::ReadOnly { name }) => assert_eq!(name, "Prod"),
        other => panic!("expected ReadOnly, got {other:?}"),
    }
}

#[test]
fn an_unknown_connection_is_named_in_the_error() {
    let (storage, _dir) = storage_with(false);
    match config_for(&storage, "gone", Access::Read) {
        Err(AppError::UnknownConnection(id)) => assert_eq!(id, "gone"),
        other => panic!("expected UnknownConnection, got {other:?}"),
    }
}
