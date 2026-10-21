use super::{SavedQueryEntry, SavedQueryStorage};
use crate::record::Stamp;
use tempfile::tempdir;

fn entry(id: &str, name: &str) -> SavedQueryEntry {
    SavedQueryEntry {
        id: id.to_string(),
        name: name.to_string(),
        mode: String::from("find"),
        filter: String::from("{}"),
        sort: String::from("{}"),
        projection: String::from("{}"),
        skip: 0,
        limit: 50,
        pipeline: String::from("[]"),
        saved_at: String::from("1"),
        stamp: Stamp::now(),
    }
}

fn names(store: &SavedQueryStorage) -> Vec<String> {
    store.load().into_iter().map(|e| e.name).collect()
}

#[test]
fn saved_queries_list_newest_first_without_the_deleted_ones() {
    let dir = tempdir().unwrap();
    let store = SavedQueryStorage::new(dir.path().join("saved_queries.json"));
    store.insert(entry("q/1", "Active users")).unwrap();
    store.insert(entry("q.2", "Orders by ünit")).unwrap();
    store.insert(entry("q 3", "Newest")).unwrap();
    store.delete("q.2").unwrap();
    assert_eq!(names(&store), vec!["Newest", "Active users"]);
    assert_eq!(store.inner.load().len(), 3);
}

#[test]
fn a_saved_queries_file_written_before_stamps_existed_still_loads() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("saved_queries.json");
    std::fs::write(&path, r#"[{ "id": "q1", "name": "Legacy", "mode": "find", "filter": "{}", "sort": "{}",
        "projection": "{}", "skip": 0, "limit": 50, "pipeline": "[]", "saved_at": "1" }]"#).unwrap();
    assert_eq!(names(&SavedQueryStorage::new(path)), vec!["Legacy"]);
}
