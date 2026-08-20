use super::*;

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "ozendb-tabs-test-{}-{}",
        tag,
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn storage(tag: &str) -> TabStorage {
    TabStorage::new(temp_dir(tag).join("tabs.json"))
}

fn quarantine_files(dir: &PathBuf) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.to_string_lossy().contains(".corrupt-"))
        .collect()
}

#[test]
fn load_missing_file_is_none() {
    let store = storage("missing");
    assert_eq!(store.load(), None);
}

#[test]
fn load_valid_session_round_trips() {
    let store = storage("roundtrip");
    let session = serde_json::json!({
        "schemaVersion": 2,
        "activeTabId": "t0",
        "tabs": [{ "id": "t0", "type": "app.quickstart" }],
    });
    store.save(&session).unwrap();
    assert_eq!(store.load().unwrap(), session);
}

#[test]
fn corrupt_file_is_quarantined_with_original_bytes() {
    let store = storage("corrupt");
    let dir = store.path.parent().unwrap().to_path_buf();
    std::fs::write(&store.path, "{ not valid json").unwrap();

    assert_eq!(store.load(), None);
    assert!(!store.path.exists(), "corrupt file must be moved aside");
    let quarantined = quarantine_files(&dir);
    assert_eq!(quarantined.len(), 1, "exactly one quarantine file");
    let saved = std::fs::read_to_string(&quarantined[0]).unwrap();
    assert_eq!(saved, "{ not valid json", "original bytes preserved");
    // A second load stays "missing" — nothing is recreated.
    assert_eq!(store.load(), None);
}

#[test]
fn a_valid_save_after_quarantine_starts_fresh() {
    let store = storage("fresh");
    let dir = store.path.parent().unwrap().to_path_buf();
    std::fs::write(&store.path, "nope").unwrap();
    store.load();

    store.save(&serde_json::json!({ "schemaVersion": 2, "activeTabId": null, "tabs": [] })).unwrap();
    assert_eq!(store.load().unwrap(), serde_json::json!({ "schemaVersion": 2, "activeTabId": null, "tabs": [] }));
    assert_eq!(quarantine_files(&dir).len(), 1);
}

#[test]
fn unreadable_file_is_treated_as_missing_without_touching_it() {
    let store = storage("unreadable");
    std::fs::write(&store.path, "{}").unwrap();
    // Simulate an unreadable file (permissions): read_to_string fails, and the
    // file must not be quarantined because we could not read its bytes to trust
    // the rename.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&store.path, std::fs::Permissions::from_mode(0o000)).unwrap();
        assert_eq!(store.load(), None);
        assert!(store.path.exists(), "unreadable file is left in place");
        std::fs::set_permissions(&store.path, std::fs::Permissions::from_mode(0o644)).unwrap();
    }
    assert_eq!(store.load().unwrap(), serde_json::json!({}));
}