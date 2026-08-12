use super::*;

// The classification is the whole feature: a domain error that slips through turns the
// log into noise, and a defect that's filtered out is a bug nobody hears about.
#[test]
fn domain_errors_are_not_defects() {
    for code in [
        "auth",
        "network",
        "tls",
        "unreachable",
        "mongo",
        "write",
        "read_only",
        "unknown_connection",
        "sql",
        "validation",
        "bson",
    ] {
        assert!(!is_defect(code), "{code} is the user's environment, not our bug");
    }
}

#[test]
fn our_own_failures_are_defects() {
    for code in ["io", "serde", "keychain", "shell", "panic", "frontend"] {
        assert!(is_defect(code), "{code} can only come from our own code");
    }
}

#[test]
fn an_unknown_code_is_not_reported() {
    // A code added later isn't a defect until someone says so here, so a new domain
    // category can't start reporting itself by accident.
    assert!(!is_defect("something_new"));
}

fn temp_store() -> (ErrorLogStore, tempfile::TempDir) {
    let dir = tempfile::tempdir().expect("tempdir");
    (ErrorLogStore::new(dir.path().join("error_log.json")), dir)
}

#[test]
fn records_are_kept_in_order() {
    let (store, _dir) = temp_store();
    store.record("io", "first").expect("record");
    store.record("shell", "second").expect("record");
    let records = store.list();
    assert_eq!(records.len(), 2);
    assert_eq!(records[0].message, "first");
    assert_eq!(records[1].code, "shell");
}

#[test]
fn the_log_is_capped_and_drops_the_oldest() {
    let (store, _dir) = temp_store();
    for i in 0..(MAX_RECORDS + 5) {
        store.record("io", &format!("error {i}")).expect("record");
    }
    let records = store.list();
    assert_eq!(records.len(), MAX_RECORDS);
    assert_eq!(records[0].message, "error 5");
    assert_eq!(records[MAX_RECORDS - 1].message, format!("error {}", MAX_RECORDS + 4));
}

#[test]
fn clearing_empties_the_log() {
    let (store, _dir) = temp_store();
    store.record("io", "boom").expect("record");
    store.clear().expect("clear");
    assert!(store.list().is_empty());
}

// Recording is diagnostics: before `init` (or if the file can't be written) it must be a
// no-op, never a panic that takes a command down with it.
#[test]
fn recording_without_a_store_is_a_no_op() {
    record("io", "no store configured in unit tests");
}
