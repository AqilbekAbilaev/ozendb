use super::*;
use tempfile::tempdir;

fn conn(id: &str, name: &str) -> ConnectionConfig {
    ConnectionConfig {
        id: id.into(),
        name: name.into(),
        hosts: vec![HostEntry { host: String::from("localhost"), port: 27017 }],
        ..Default::default()
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
    assert_eq!(storage.load()[0].engine_kind(), Engine::Mongo);
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
fn a_record_without_an_engine_key_loads_as_mongodb() {
    // Every connections.json written before the engine field existed looks like
    // this, and MongoDB is the only driver it could have described.
    let json = r#"{"id":"1","name":"Local","connection_type":"standalone","auth_db":"admin"}"#;
    let config: ConnectionConfig = serde_json::from_str(json).unwrap();
    assert_eq!(config.engine_kind(), Engine::Mongo);
    let mongo = config.engine.as_mongo().unwrap();
    assert_eq!(mongo.auth_db.as_deref(), Some("admin"));
}

#[test]
fn postgres_is_accepted_as_a_synonym_for_postgresql() {
    // The app only ever writes "postgresql", but "postgres" is the spelling sqlx,
    // libpq and the URI scheme use, so a hand-edited file may well carry it.
    let json = r#"{"id":"1","name":"Local","engine":"postgres","database":"appdb"}"#;
    let config: ConnectionConfig = serde_json::from_str(json).unwrap();
    assert_eq!(config.engine_kind(), Engine::Postgres);
    assert_eq!(
        config.engine.as_postgres().and_then(|p| p.database.as_deref()),
        Some("appdb")
    );
}

#[test]
fn an_unknown_engine_is_an_error_rather_than_a_silent_mongodb() {
    // Guessing here would dial the wrong driver entirely. The file is quarantined
    // rather than emptied (see read_from_disk), so a typo is recoverable.
    let json = r#"{"id":"1","name":"Local","engine":"cassandra"}"#;
    assert!(serde_json::from_str::<ConnectionConfig>(json).is_err());
}

#[test]
fn a_saved_record_writes_its_engine_tag_back() {
    let config = ConnectionConfig {
        engine: EngineConfig::Postgres(PostgresConfig { database: Some(String::from("appdb")) }),
        ..conn("1", "Local")
    };
    let json = serde_json::to_string(&config).unwrap();
    assert!(json.contains(r#""engine":"postgresql""#), "tag must round-trip: {json}");
    assert_eq!(serde_json::from_str::<ConnectionConfig>(&json).unwrap(), config);
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
fn mongo_config_kind_reads_the_stored_string() {
    let mongo = MongoConfig { connection_type: String::from("srv"), ..Default::default() };
    assert_eq!(mongo.kind(), ConnectionKind::Srv);
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

