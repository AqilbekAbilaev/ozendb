use super::*;
use tempfile::tempdir;

fn store_in_tempdir() -> (KnownHostsStore, tempfile::TempDir) {
    let dir = tempdir().unwrap();
    let store = KnownHostsStore::new(dir.path().join("known_hosts.json"));
    (store, dir)
}

#[test]
fn classify_unknown_when_nothing_stored() {
    assert_eq!(classify(None, "ssh-ed25519 AAAA"), HostKeyCheck::Unknown);
}

#[test]
fn classify_match_when_equal() {
    assert_eq!(
        classify(Some("ssh-ed25519 AAAA"), "ssh-ed25519 AAAA"),
        HostKeyCheck::Match
    );
}

#[test]
fn classify_changed_when_different() {
    assert_eq!(
        classify(Some("ssh-ed25519 AAAA"), "ssh-ed25519 BBBB"),
        HostKeyCheck::Changed
    );
}

#[test]
fn check_is_unknown_then_match_after_record() {
    let (store, _dir) = store_in_tempdir();
    assert_eq!(
        store.check("bastion.example.com", 22, "ssh-ed25519 AAAA"),
        HostKeyCheck::Unknown
    );
    store
        .record("bastion.example.com", 22, "ssh-ed25519 AAAA")
        .unwrap();
    assert_eq!(
        store.check("bastion.example.com", 22, "ssh-ed25519 AAAA"),
        HostKeyCheck::Match
    );
}

#[test]
fn check_is_changed_when_key_differs() {
    let (store, _dir) = store_in_tempdir();
    store
        .record("bastion.example.com", 22, "ssh-ed25519 AAAA")
        .unwrap();
    assert_eq!(
        store.check("bastion.example.com", 22, "ssh-ed25519 BBBB"),
        HostKeyCheck::Changed
    );
}

#[test]
fn record_does_not_duplicate_on_retrust() {
    let (store, _dir) = store_in_tempdir();
    store
        .record("bastion.example.com", 22, "ssh-ed25519 AAAA")
        .unwrap();
    // Re-trust with a new key (e.g. after a remove) replaces, not appends.
    store
        .record("bastion.example.com", 22, "ssh-ed25519 BBBB")
        .unwrap();
    let hosts = store.load();
    assert_eq!(hosts.len(), 1);
    assert_eq!(hosts[0].key, "ssh-ed25519 BBBB");
}

#[test]
fn remove_forgets_only_the_named_host() {
    let (store, _dir) = store_in_tempdir();
    store.record("a.example.com", 22, "ssh-ed25519 AAAA").unwrap();
    store.record("b.example.com", 22, "ssh-ed25519 BBBB").unwrap();
    store.remove("a.example.com", 22).unwrap();
    let hosts = store.load();
    assert_eq!(hosts.len(), 1);
    assert_eq!(hosts[0].host, "b.example.com");
    // After forgetting, the host reads as a fresh first contact again.
    assert_eq!(
        store.check("a.example.com", 22, "ssh-ed25519 AAAA"),
        HostKeyCheck::Unknown
    );
}

#[test]
fn different_port_is_a_separate_host() {
    let (store, _dir) = store_in_tempdir();
    store.record("bastion.example.com", 22, "ssh-ed25519 AAAA").unwrap();
    // Same host name, different port → recorded independently.
    store.record("bastion.example.com", 2222, "ssh-ed25519 BBBB").unwrap();
    assert_eq!(store.load().len(), 2);
}

#[test]
fn forgetting_a_host_keeps_only_its_address_on_disk() {
    let (store, dir) = store_in_tempdir();
    store.record("bastion ü.example.com", 2222, "ssh-ed25519 AAAA").unwrap();
    store.remove("bastion ü.example.com", 2222).unwrap();
    assert_eq!(store.stored_key("bastion ü.example.com", 2222), None);
    let on_disk = std::fs::read_to_string(dir.path().join("known_hosts.json")).unwrap();
    assert!(on_disk.contains("bastion ü.example.com"));
    assert!(on_disk.contains(r#""deleted": true"#));
    assert!(!on_disk.contains("AAAA"));
}

#[test]
fn a_forgotten_host_can_be_trusted_again() {
    let (store, _dir) = store_in_tempdir();
    store.record("bastion.example.com", 22, "ssh-ed25519 AAAA").unwrap();
    store.remove("bastion.example.com", 22).unwrap();
    store.record("bastion.example.com", 22, "ssh-ed25519 BBBB").unwrap();
    assert_eq!(store.check("bastion.example.com", 22, "ssh-ed25519 BBBB"), HostKeyCheck::Match);
    assert_eq!(store.inner.load().len(), 1);
}

#[test]
fn a_known_hosts_file_written_before_stamps_existed_still_loads() {
    let (store, dir) = store_in_tempdir();
    std::fs::write(
        dir.path().join("known_hosts.json"),
        r#"[{ "host": "old.example.com", "port": 22, "key": "ssh-ed25519 AAAA", "added": "1" }]"#,
    ).unwrap();
    assert_eq!(store.check("old.example.com", 22, "ssh-ed25519 AAAA"), HostKeyCheck::Match);
}
