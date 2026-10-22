use super::*;
use crate::keychain::fake::{FakeKeychain, LockedKeychain, RefusingKeychain, UnavailableKeychain};
use crate::settings::Settings;
use crate::sync::test_device::{connection, folder, Device};

const DAY: i64 = 24 * 60 * 60 * 1000;
const NOW: i64 = 1_000 * DAY;

fn merge() -> Merge {
    Merge::new(NOW, Some(NOW - DAY))
}

fn decoded(snapshot: &Snapshot) -> Snapshot {
    Snapshot::decode(&snapshot.encode().unwrap()).unwrap()
}

fn text(snapshot: &Snapshot) -> String {
    String::from_utf8(snapshot.encode().unwrap().to_vec()).unwrap()
}

#[test]
fn reading_includes_deleted_markers() {
    let device = Device::new();
    device.folders.insert(folder("f1", "kept", 1)).unwrap();
    device.folders.insert(folder("f2", "gone", 1)).unwrap();
    device.folders.delete("f2").unwrap();

    let snapshot = device.read();
    assert_eq!(snapshot.records.folders.len(), 2);
    assert!(snapshot.records.folders.iter().any(|f| f.id == "f2" && f.stamp.deleted));
}

#[test]
fn reading_carries_each_connections_password() {
    let device = Device::new();
    device.hold(connection("c1", "prod", 1));
    device.keychain.write("c1", "s3cret").unwrap();

    assert!(text(&device.read()).contains("s3cret"));
}

#[test]
fn reading_fails_when_the_keychain_is_locked() {
    let device = Device::new();
    device.hold(connection("c1", "prod", 1));

    let result = Snapshot::read(&device.stores(), &LockedKeychain);
    assert_eq!(result.unwrap_err().code(), "keychain");
}

#[test]
fn reading_takes_postgres_saved_sql_but_not_its_run_history() {
    let device = Device::new();
    device.pg_queries.save("q1", "count", "c1", "select 1", "now").unwrap();
    device.pg_queries.push_history("c1", "select 2", "now").unwrap();

    let blob = text(&device.read());
    assert!(blob.contains("select 1"));
    assert!(!blob.contains("select 2"));
}

#[test]
fn the_upload_leaves_out_local_only_settings() {
    let device = Device::new();
    device.settings.update(|s| Settings { ui_zoom: 1.5, theme: "light".into(), ..s.clone() }).unwrap();

    let blob = text(&device.read());
    assert!(blob.contains("light"));
    assert!(!blob.contains("ui_zoom"));
}

#[test]
fn a_decoded_upload_holds_the_same_records() {
    let device = Device::new();
    device.hold(connection("c1", "prod", 1));
    device.keychain.write("c1", "s3cret").unwrap();
    device.node_tags.set("c1/shop", "red").unwrap();

    let snapshot = device.read();
    assert!(decoded(&snapshot).same_as(&snapshot).unwrap());
}

#[test]
fn a_newer_format_is_refused() {
    let error = Snapshot::decode(br#"{"format": 2}"#).unwrap_err();
    assert_eq!(error.code(), "newer_sync_format");
}

#[test]
fn unreadable_data_is_reported_without_quoting_it() {
    let error = Snapshot::decode(br#"{"format": 1, "connections": "s3cret"}"#).unwrap_err();
    assert_eq!(error.code(), "unreadable_sync_data");
    assert!(!error.to_string().contains("s3cret"));
}

#[test]
fn order_does_not_make_two_snapshots_differ() {
    let a = Device::new();
    a.folders.insert(folder("f1", "one", 1)).unwrap();
    a.folders.insert(folder("f2", "two", 1)).unwrap();
    let b = Device::new();
    b.folders.inner.save(&a.folders.inner.load().into_iter().rev().collect()).unwrap();

    assert!(a.read().same_as(&b.read()).unwrap());
}

#[test]
fn a_different_password_makes_two_snapshots_differ() {
    let a = Device::new();
    a.hold(connection("c1", "prod", 1));
    a.keychain.write("c1", "old").unwrap();
    let before = a.read();
    a.keychain.write("c1", "new").unwrap();

    assert!(!a.read().same_as(&before).unwrap());
}

#[test]
fn the_password_comes_from_the_side_whose_record_won() {
    let mine = Device::new();
    mine.hold(connection("c1", "prod", 1));
    mine.keychain.write("c1", "mine").unwrap();
    let theirs = Device::new();
    theirs.hold(connection("c1", "prod renamed", 5));
    theirs.keychain.write("c1", "theirs").unwrap();

    let remote_won = mine.read().merged(decoded(&theirs.read()), &merge());
    let local_won = theirs.read().merged(decoded(&mine.read()), &merge());
    assert!(text(&remote_won).contains("theirs"));
    assert!(!text(&remote_won).contains("mine"));
    assert!(text(&local_won).contains("theirs"));
}

#[test]
fn writing_back_saves_every_store_and_the_won_passwords() {
    let device = Device::new();
    device.hold(connection("c1", "prod", 1));
    device.keychain.write("c1", "old").unwrap();
    let other = Device::new();
    other.hold(connection("c1", "prod", 9));
    other.keychain.write("c1", "new").unwrap();
    other.folders.insert(folder("f1", "from elsewhere", 9)).unwrap();

    let before = device.read();
    let merged = before.clone().merged(decoded(&other.read()), &merge());
    let written = device.write(&merged, &before);

    assert!(written.complete);
    assert_eq!(written.changed_connections, vec!["c1".to_string()]);
    assert_eq!(device.keychain.read("c1").unwrap().as_deref().map(String::as_str), Some("new"));
    assert_eq!(device.folders.load()[0].name, "from elsewhere");
}

#[test]
fn a_store_edited_during_the_sync_is_left_alone() {
    let device = Device::new();
    let other = Device::new();
    other.folders.insert(folder("f1", "from elsewhere", 9)).unwrap();
    other.node_tags.set("c1/shop", "red").unwrap();

    let before = device.read();
    let merged = before.clone().merged(decoded(&other.read()), &merge());
    device.folders.insert(folder("f2", "typed meanwhile", 10)).unwrap();
    let written = device.write(&merged, &before);

    assert!(!written.complete);
    let names: Vec<String> = device.folders.load().into_iter().map(|f| f.name).collect();
    assert_eq!(names, vec!["typed meanwhile"]);
    assert_eq!(device.node_tags.colors().get("c1/shop").map(String::as_str), Some("red"));
}

#[test]
fn opening_a_connection_during_the_sync_does_not_block_the_write() {
    let device = Device::new();
    device.hold(connection("c1", "prod", 1));
    let other = Device::new();
    other.hold(connection("c1", "prod renamed", 9));

    let before = device.read();
    let merged = before.clone().merged(decoded(&other.read()), &merge());
    device.connections.update_with(|list| list[0].open = true).unwrap();
    let written = device.write(&merged, &before);

    assert!(written.complete);
    let saved = &device.connections.load()[0];
    assert_eq!((saved.name.as_str(), saved.open), ("prod renamed", true));
}

#[test]
fn writing_back_keeps_postgres_run_history() {
    let device = Device::new();
    device.pg_queries.push_history("c1", "select 2", "now").unwrap();
    let other = Device::new();
    other.pg_queries.save("q1", "count", "c1", "select 1", "now").unwrap();

    let before = device.read();
    let merged = before.clone().merged(decoded(&other.read()), &merge());
    device.write(&merged, &before);

    assert_eq!(device.pg_queries.saved("c1").len(), 1);
    assert_eq!(device.pg_queries.history("c1").len(), 1);
}

#[test]
fn a_connection_deleted_elsewhere_keeps_none_of_this_devices_state() {
    let device = Device::new();
    device.hold(ConnectionConfig { open: true, last_accessed: Some("yesterday".into()), ..connection("c1", "prod", 1) });
    let other = Device::new();
    other.hold(connection("c1", "prod", 1));
    other.connections.remove("c1").unwrap();

    let before = device.read();
    let merged = before.clone().merged(decoded(&other.read()), &merge());
    device.write(&merged, &before);

    let saved = &device.connections.records()[0];
    assert!(saved.stamp.deleted);
    assert_eq!((saved.open, saved.last_accessed.clone()), (false, None));
}

#[test]
fn a_connection_the_merge_drops_leaves_no_secrets_behind() {
    let device = Device::new();
    device.hold(connection("c1", "prod", 1));
    device.keychain.write("c1", "s3cret").unwrap();
    device.keychain.write("c1::ssh-pass", "tunnel").unwrap();
    let stale = Merge::new(NOW, Some(NOW - 100 * DAY));

    let before = device.read();
    let merged = before.clone().merged(decoded(&Device::new().read()), &stale);
    let written = device.write(&merged, &before);

    assert!(device.keychain.entries().is_empty());
    assert_eq!(written.changed_connections, vec!["c1".to_string()]);
}

#[test]
fn every_connection_the_merge_changed_is_reported_and_no_other() {
    let device = Device::new();
    device.hold(connection("c1", "prod", 1));
    device.hold(connection("c2", "same", 1));
    let other = Device::new();
    other.hold(connection("c1", "prod moved", 9));
    other.hold(connection("c2", "same", 1));

    let before = device.read();
    let merged = before.clone().merged(decoded(&other.read()), &merge());
    let written = device.write(&merged, &before);

    assert_eq!(written.changed_connections, vec!["c1".to_string()]);
}

#[test]
fn a_refused_secret_still_writes_the_rest_and_reports_them() {
    let device = Device::new();
    device.hold(connection("c1", "one", 1));
    device.hold(connection("c2", "two", 1));
    let other = Device::new();
    other.hold(connection("c1", "one", 9));
    other.hold(connection("c2", "two", 9));
    other.keychain.write("c1", "new one").unwrap();
    other.keychain.write("c2", "new two").unwrap();
    other.folders.insert(folder("f1", "from elsewhere", 9)).unwrap();
    let keychain = RefusingKeychain(FakeKeychain::default(), "c1");

    let before = device.read();
    let merged = before.clone().merged(decoded(&other.read()), &merge());
    let written = merged.write_if_unchanged(&before, &device.stores(), &keychain).unwrap();

    assert_eq!(written.keychain_error.map(|e| e.code()), Some("keychain"));
    assert_eq!(written.changed_connections, vec!["c1".to_string(), "c2".to_string()]);
    assert_eq!(keychain.0.read("c2").unwrap().as_deref().map(String::as_str), Some("new two"));
    assert_eq!(device.folders.load()[0].name, "from elsewhere");
}

#[test]
fn the_upload_holds_one_key_per_store() {
    let blob: serde_json::Value = serde_json::from_str(&text(&Device::new().read())).unwrap();
    let mut keys: Vec<&String> = blob.as_object().unwrap().keys().collect();
    keys.sort();
    let expected = [
        "connections", "default_queries", "folders", "format", "known_hosts", "node_tags", "pg_saved", "saved_queries", "settings",
    ];
    assert_eq!(keys, expected);
}

/// What a device without a keyring service sends: its connections, passwords unknown.
fn read_without_keyring(device: &Device) -> Snapshot {
    Snapshot::read(&device.stores(), &UnavailableKeychain).unwrap()
}

#[test]
fn reading_without_a_keyring_service_still_reads_every_connection() {
    let device = Device::new();
    device.hold(connection("c.1 ü", "prod", 1));

    let snapshot = read_without_keyring(&device);

    assert_eq!(snapshot.connections.len(), 1);
    assert!(decoded(&snapshot).connections[0].passwords_unknown());
}

#[test]
fn a_newer_edit_from_a_device_without_a_keyring_keeps_the_passwords_held_elsewhere() {
    let mine = Device::new();
    mine.hold(connection("c.1 ü", "prod", 1));
    mine.keychain.write("c.1 ü", "s3cret pässword").unwrap();
    let theirs = Device::new();
    theirs.hold(connection("c.1 ü", "prod renamed", 5));

    let remote_won = mine.read().merged(decoded(&read_without_keyring(&theirs)), &merge());
    let local_won = read_without_keyring(&theirs).merged(decoded(&mine.read()), &merge());

    for merged in [remote_won, local_won] {
        assert!(text(&merged).contains("prod renamed"));
        assert!(text(&merged).contains("s3cret pässword"));
        assert!(!merged.connections[0].passwords_unknown());
    }
}

#[test]
fn unknown_passwords_do_not_make_two_snapshots_differ() {
    let mine = Device::new();
    mine.hold(connection("c.1 ü", "prod", 1));
    mine.keychain.write("c.1 ü", "s3cret").unwrap();
    let theirs = Device::new();
    theirs.hold(connection("c.1 ü", "prod", 1));

    let unknown = read_without_keyring(&theirs);
    let merged = unknown.clone().merged(decoded(&mine.read()), &merge());

    assert!(merged.same_as(&unknown).unwrap());
}

#[test]
fn passwords_that_cannot_be_kept_without_a_keyring_are_reported_as_such() {
    let device = Device::new();
    device.hold(connection("c.1 ü", "prod", 1));
    let other = Device::new();
    other.hold(connection("c.1 ü", "prod", 9));
    other.keychain.write("c.1 ü", "s3cret").unwrap();

    let before = read_without_keyring(&device);
    let merged = before.clone().merged(decoded(&other.read()), &merge());
    let written = merged.write_if_unchanged(&before, &device.stores(), &UnavailableKeychain).unwrap();

    assert!(written.complete);
    assert_eq!(written.keychain_error.map(|e| e.code()), Some("keychain_unavailable"));
}


#[test]
fn unknown_passwords_alone_change_no_connection() {
    let device = Device::new();
    device.hold(connection("c.1 ü", "prod", 1));
    let other = Device::new();
    other.hold(connection("c.1 ü", "prod", 1));
    other.keychain.write("c.1 ü", "s3cret").unwrap();

    let before = read_without_keyring(&device);
    let merged = before.clone().merged(decoded(&other.read()), &merge());
    let written = merged.write_if_unchanged(&before, &device.stores(), &UnavailableKeychain).unwrap();

    assert!(written.changed_connections.is_empty());
    assert_eq!(written.keychain_error.map(|e| e.code()), Some("keychain_unavailable"));
}
