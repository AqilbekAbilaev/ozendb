use super::{DefaultQuery, DefaultQueryStorage};
use crate::record::Stamp;
use tempfile::tempdir;

fn query(filter: &str) -> DefaultQuery {
    DefaultQuery {
        mode: String::from("find"),
        filter: filter.to_string(),
        sort: String::from("{}"),
        projection: String::from("{}"),
        skip: 0,
        limit: 50,
        pipeline: String::from("[]"),
        stamp: Stamp::now(),
    }
}

fn store() -> (tempfile::TempDir, DefaultQueryStorage) {
    let dir = tempdir().unwrap();
    let store = DefaultQueryStorage::new(dir.path().join("default_queries.json"));
    (dir, store)
}

#[test]
fn a_cleared_default_query_is_hidden_and_kept_on_disk_without_its_query() {
    let (dir, s) = store();
    s.set("c 1::db.ü::orders", query(r#"{"secret":1}"#)).unwrap();
    s.clear("c 1::db.ü::orders").unwrap();
    assert!(s.get("c 1::db.ü::orders").is_none());
    let on_disk = std::fs::read_to_string(dir.path().join("default_queries.json")).unwrap();
    assert!(on_disk.contains(r#""deleted": true"#));
    assert!(!on_disk.contains("secret"));
}

#[test]
fn removing_a_connection_marks_only_its_default_queries_deleted() {
    let (_dir, s) = store();
    s.set("c 1::db::orders", query("{}")).unwrap();
    s.set("c 10::db::orders", query("{}")).unwrap();
    s.remove_connection("c 1").unwrap();
    assert!(s.get("c 1::db::orders").is_none());
    assert!(s.get("c 10::db::orders").is_some());
    assert!(s.inner.load()["c 1::db::orders"].stamp.deleted);
}

#[test]
fn setting_a_cleared_default_query_again_brings_it_back() {
    let (_dir, s) = store();
    s.set("c::db::coll", query("{}")).unwrap();
    s.clear("c::db::coll").unwrap();
    s.set("c::db::coll", query(r#"{"a":1}"#)).unwrap();
    assert_eq!(s.get("c::db::coll").unwrap().filter, r#"{"a":1}"#);
}

#[test]
fn a_default_queries_file_written_before_stamps_existed_still_loads() {
    let (dir, s) = store();
    std::fs::write(dir.path().join("default_queries.json"), r#"{ "c::db::coll": { "mode": "find", "filter": "{}",
        "sort": "{}", "projection": "{}", "skip": 0, "limit": 50, "pipeline": "[]" } }"#).unwrap();
    assert_eq!(s.get("c::db::coll").unwrap().stamp.updated_at, 0);
}
