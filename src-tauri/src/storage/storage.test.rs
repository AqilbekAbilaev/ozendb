use super::*;
use tempfile::tempdir;

fn conn(id: &str, name: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: id.into(),
        name: name.into(),
        engine: String::from("mongodb"),
        database: None,
        hosts: vec![HostEntry { host: String::from("localhost"), port: 27017 }],
        connection_type: String::from("standalone"),
        replica_set_name: None,
        username: None,
        auth_db: None,
        auth_mechanism: None,
        options: BTreeMap::new(),
        tls: false,
        tls_ca_file: None,
        tls_cert_key_file: None,
        tls_allow_invalid_certificates: false,
        ssh_enabled: false,
        ssh_host: None,
        ssh_port: 22,
        ssh_user: None,
        ssh_auth: None,
        ssh_key_file: None,
        tag: None,
        read_only: false,
        folder_id: None,
        last_accessed: None,
        open: false,
    }
}

fn storage_in_tempdir() -> (Storage, tempfile::TempDir) {
    let dir = tempdir().unwrap();
    let s = Storage::new(dir.path().join("connections.json"));
    (s, dir)
}

#[test]
fn load_returns_empty_when_file_missing() {
    let (storage, _dir) = storage_in_tempdir();
    assert!(storage.load().is_empty());
}

#[test]
fn save_and_load_roundtrip() {
    let (storage, _dir) = storage_in_tempdir();
    let conns = vec![
        conn("1", "Local"),
        conn("2", "Prod"),
    ];
    storage.save(&conns).unwrap();
    assert_eq!(storage.load(), conns);
}

#[test]
fn save_overwrites_existing_file() {
    let (storage, _dir) = storage_in_tempdir();
    storage.save(&[conn("1", "Old")]).unwrap();
    storage.save(&[conn("1", "New")]).unwrap();
    let loaded = storage.load();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].name, "New");
}

// Returns the first `*.corrupt-*` sibling in `dir`, if any.
fn find_corrupt_backup(dir: &std::path::Path) -> Option<PathBuf> {
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
fn load_returns_empty_on_corrupt_file() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("connections.json");
    std::fs::write(&path, "not valid json {{ garbage").unwrap();
    let storage = Storage::new(path.clone());
    assert!(storage.load().is_empty());
    // The corrupt file is quarantined aside, not left at the target path...
    assert!(!path.exists());
    // ...and its original bytes survive in the `.corrupt-*` backup.
    let backup = find_corrupt_backup(dir.path())
        .expect("a .corrupt-* backup should exist");
    assert_eq!(
        std::fs::read_to_string(&backup).unwrap(),
        "not valid json {{ garbage"
    );
}

#[test]
fn corrupt_load_then_write_preserves_original() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("connections.json");
    std::fs::write(&path, "not valid json {{ garbage").unwrap();
    let storage = Storage::new(path.clone());
    // Loading a corrupt file yields empty (and quarantines the original).
    assert!(storage.load().is_empty());
    // A subsequent write persists a fresh file with the added connection...
    storage.add(conn("1", "Local")).unwrap();
    let loaded = storage.load();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].id, "1");
    // ...and the corrupt bytes survive in the backup — the core anti-data-loss
    // guarantee: the write never overwrote the recoverable original.
    let backup = find_corrupt_backup(dir.path())
        .expect("a .corrupt-* backup should exist");
    assert_eq!(
        std::fs::read_to_string(&backup).unwrap(),
        "not valid json {{ garbage"
    );
}

#[test]
fn add_appends_to_existing() {
    let (storage, _dir) = storage_in_tempdir();
    storage.add(conn("1", "Local")).unwrap();
    storage.add(conn("2", "Prod")).unwrap();
    let loaded = storage.load();
    assert_eq!(loaded.len(), 2);
    assert_eq!(loaded[1].id, "2");
}

#[test]
fn remove_deletes_by_id() {
    let (storage, _dir) = storage_in_tempdir();
    storage.save(&[
        conn("1", "Keep"),
        conn("2", "Delete"),
    ]).unwrap();
    storage.remove("2").unwrap();
    let loaded = storage.load();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].id, "1");
}

#[test]
fn remove_nonexistent_id_is_noop() {
    let (storage, _dir) = storage_in_tempdir();
    storage.save(&[conn("1", "Local")]).unwrap();
    storage.remove("999").unwrap();
    assert_eq!(storage.load().len(), 1);
}

#[test]
fn load_preserves_existing_hosts_array() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("connections.json");
    std::fs::write(
        &path,
        r#"[{"id":"1","name":"RS","hosts":[{"host":"a","port":1},{"host":"b","port":2}],"connection_type":"replica"}]"#,
    ).unwrap();
    let storage = Storage::new(path);
    let loaded = storage.load();
    assert_eq!(loaded[0].hosts.len(), 2);
    assert_eq!(loaded[0].hosts[1].host, "b");
}

#[test]
fn load_defaults_engine_for_files_written_before_the_field_existed() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("connections.json");
    std::fs::write(
        &path,
        r#"[{"id":"1","name":"Local","hosts":[{"host":"a","port":1}],"connection_type":"standalone"}]"#,
    ).unwrap();
    let storage = Storage::new(path);
    assert_eq!(storage.load()[0].engine, "mongodb");
}

#[test]
fn save_creates_parent_directories() {
    let dir = tempdir().unwrap();
    let nested_path = dir.path().join("a").join("b").join("connections.json");
    let storage = Storage::new(nested_path);
    storage.save(&[conn("1", "Local")]).unwrap();
    assert_eq!(storage.load().len(), 1);
}

#[test]
fn engine_maps_known_strings() {
    assert_eq!(Engine::from_str("mongodb"), Engine::Mongo);
    assert_eq!(Engine::from_str("postgresql"), Engine::Postgres);
}

#[test]
fn engine_unknown_or_missing_falls_back_to_mongo() {
    // Connections saved before this field existed have no `engine` key; serde's
    // `default_engine` already turns that into `"mongodb"`, but `from_str` itself
    // must also treat any unrecognized value as Mongo rather than erroring.
    assert_eq!(Engine::from_str(""), Engine::Mongo);
    assert_eq!(Engine::from_str("whatever"), Engine::Mongo);
}

#[test]
fn config_engine_kind_reads_the_stored_string() {
    let mut config = conn("1", "Local");
    config.engine = String::from("postgresql");
    assert_eq!(config.engine_kind(), Engine::Postgres);
}

#[test]
fn connection_kind_maps_known_strings() {
    assert_eq!(ConnectionKind::from_str("standalone"), ConnectionKind::Standalone);
    assert_eq!(ConnectionKind::from_str("srv"), ConnectionKind::Srv);
    assert_eq!(ConnectionKind::from_str("replica"), ConnectionKind::Replica);
}

#[test]
fn connection_kind_unknown_falls_back_to_standalone() {
    // Unknown or legacy values must take the non-SRV path, matching uri.rs's
    // pre-enum behaviour (only "srv" was ever special-cased).
    assert_eq!(ConnectionKind::from_str("dns"), ConnectionKind::Standalone);
    assert_eq!(ConnectionKind::from_str(""), ConnectionKind::Standalone);
    assert_eq!(ConnectionKind::from_str("whatever"), ConnectionKind::Standalone);
}

#[test]
fn config_kind_reads_the_stored_string() {
    let mut config = conn("1", "Local");
    config.connection_type = String::from("srv");
    assert_eq!(config.kind(), ConnectionKind::Srv);
}

#[test]
fn ssh_auth_method_maps_key_and_defaults_to_password() {
    assert_eq!(SshAuthMethod::from_opt(Some("key")), SshAuthMethod::Key);
    assert_eq!(SshAuthMethod::from_opt(Some("password")), SshAuthMethod::Password);
    // None and any unknown value default to Password (pool.rs's prior `_` arm).
    assert_eq!(SshAuthMethod::from_opt(None), SshAuthMethod::Password);
    assert_eq!(SshAuthMethod::from_opt(Some("")), SshAuthMethod::Password);
    assert_eq!(SshAuthMethod::from_opt(Some("mystery")), SshAuthMethod::Password);
}

#[test]
fn config_ssh_auth_method_reads_the_stored_string() {
    let mut config = conn("1", "Local");
    config.ssh_auth = Some(String::from("key"));
    assert_eq!(config.ssh_auth_method(), SshAuthMethod::Key);
    config.ssh_auth = None;
    assert_eq!(config.ssh_auth_method(), SshAuthMethod::Password);
}
