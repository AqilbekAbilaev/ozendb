use super::*;
use tempfile::tempdir;

fn entry(op: &str, before: Option<&str>) -> HistoryEntry {
    HistoryEntry {
        id: uuid::Uuid::new_v4().to_string(),
        conn_id: String::from("c1"),
        database: String::from("db"),
        collection: String::from("coll"),
        op: op.to_string(),
        at: 0,
        doc_id: String::from("{\"$oid\":\"507f1f77bcf86cd799439011\"}"),
        before: before.map(str::to_string),
        pre_image_dropped: false,
    }
}

const SMALL: Limits = Limits { max_entries: 3, max_pre_image_bytes: 10, max_total_bytes: 25 };

#[test]
fn a_pre_image_within_the_cap_is_kept() {
    let mut entries = Vec::new();
    add(&mut entries, entry("update", Some("0123456789")), &SMALL);
    assert_eq!(entries[0].before.as_deref(), Some("0123456789"));
    assert!(!entries[0].pre_image_dropped);
}

#[test]
fn an_oversized_pre_image_is_dropped_but_the_change_is_still_recorded() {
    let mut entries = Vec::new();
    add(&mut entries, entry("update", Some("01234567890")), &SMALL);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].before, None);
    assert!(entries[0].pre_image_dropped);
}

#[test]
fn newest_entries_win_when_the_count_cap_is_reached() {
    let mut entries = Vec::new();
    for op in ["insert", "update", "delete", "insert"] {
        add(&mut entries, entry(op, None), &SMALL);
    }
    let ops: Vec<&str> = entries.iter().map(|e| e.op.as_str()).collect();
    assert_eq!(ops, ["insert", "delete", "update"]);
}

#[test]
fn old_entries_roll_off_once_the_pre_images_pass_the_total_budget() {
    let mut entries = Vec::new();
    add(&mut entries, entry("update", Some("aaaaaaaaaa")), &SMALL);
    add(&mut entries, entry("update", Some("bbbbbbbbbb")), &SMALL);
    // 30 bytes of pre-images is over the 25-byte budget: the oldest goes.
    add(&mut entries, entry("update", Some("cccccccccc")), &SMALL);
    let kept: Vec<&str> = entries.iter().filter_map(|e| e.before.as_deref()).collect();
    assert_eq!(kept, ["cccccccccc", "bbbbbbbbbb"]);
}

#[test]
fn the_newest_entry_is_kept_even_alone_over_budget() {
    let limits = Limits { max_entries: 3, max_pre_image_bytes: 100, max_total_bytes: 5 };
    let mut entries = Vec::new();
    add(&mut entries, entry("update", Some("0123456789")), &limits);
    assert_eq!(entries.len(), 1);
}

#[test]
fn restore_explains_a_dropped_pre_image() {
    let mut dropped = entry("delete", None);
    dropped.pre_image_dropped = true;
    assert!(dropped.restore_blocker().unwrap().contains("too large"));
    assert!(entry("update", None).restore_blocker().unwrap().contains("no saved pre-image"));
    assert_eq!(entry("update", Some("{}")).restore_blocker(), None);
    assert_eq!(entry("insert", None).restore_blocker(), None);
}

#[test]
fn entries_written_before_the_flag_existed_still_load() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("collection_history.json");
    std::fs::write(
        &path,
        r#"[{"id":"x","conn_id":"c1","database":"db","collection":"coll","op":"update","at":0,"doc_id":"1","before":"{}"}]"#,
    )
    .unwrap();
    let store = CollectionHistoryStore::new(path);
    let entries = store.list_for("c1", "db", "coll");
    assert_eq!(entries.len(), 1);
    assert!(!entries[0].pre_image_dropped);
}
