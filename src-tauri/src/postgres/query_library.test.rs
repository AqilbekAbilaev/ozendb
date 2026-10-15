use super::{PgQueryLibraryStore, MAX_HISTORY};
use tempfile::tempdir;

fn store() -> (tempfile::TempDir, PgQueryLibraryStore) {
    let dir = tempdir().unwrap();
    let store = PgQueryLibraryStore::new(dir.path().join("pg_queries.json"));
    (dir, store)
}

#[test]
fn history_is_per_connection_newest_first_without_repeats() {
    let (_dir, s) = store();
    s.push_history("c1", "SELECT 1", "t1").unwrap();
    s.push_history("c1", "SELECT 2", "t2").unwrap();
    s.push_history("c1", "  SELECT 1  ", "t3").unwrap();
    s.push_history("c2", "SELECT 9", "t4").unwrap();
    let sqls: Vec<String> = s.history("c1").into_iter().map(|e| e.sql).collect();
    assert_eq!(sqls, vec!["SELECT 1", "SELECT 2"]);
    assert_eq!(s.history("c1")[0].ran_at, "t3");
    assert_eq!(s.history("c2").len(), 1);

    s.clear_history("c1").unwrap();
    assert!(s.history("c1").is_empty());
    assert_eq!(s.history("c2").len(), 1);
}

#[test]
fn history_keeps_only_the_most_recent_runs() {
    let (_dir, s) = store();
    for i in 0..MAX_HISTORY + 5 {
        s.push_history("c1", &format!("SELECT {i}"), "t").unwrap();
    }
    let history = s.history("c1");
    assert_eq!(history.len(), MAX_HISTORY);
    assert_eq!(history[0].sql, format!("SELECT {}", MAX_HISTORY + 4));
}

#[test]
fn saved_queries_are_listed_for_their_connection_newest_first_and_deleted_by_id() {
    let (_dir, s) = store();
    s.save("a", "Top merchants", "c1", "SELECT 1", "t1").unwrap();
    s.save("b", "Other", "c2", "SELECT 2", "t2").unwrap();
    s.save("c", "Recent", "c1", "SELECT 3", "t3").unwrap();
    let names: Vec<String> = s.saved("c1").into_iter().map(|q| q.name).collect();
    assert_eq!(names, vec!["Recent", "Top merchants"]);
    s.delete_saved("a").unwrap();
    assert_eq!(s.saved("c1").len(), 1);
    assert_eq!(s.saved("c2").len(), 1);
}

#[test]
fn a_deleted_saved_query_is_hidden_but_kept_as_a_tombstone() {
    let (_dir, s) = store();
    s.save("a/1", "Top merchänts", "c1", "SELECT 1", "t1").unwrap();
    s.delete_saved("a/1").unwrap();
    assert!(s.saved("c1").is_empty());
    assert!(s.load().saved[0].stamp.deleted);
}

#[test]
fn removing_a_connection_erases_its_saved_queries_from_disk() {
    let (_dir, s) = store();
    s.save("a", "Gone", "c 1", "SELECT 1", "t1").unwrap();
    s.save("b", "Kept", "c.2", "SELECT 2", "t2").unwrap();
    s.remove_connection("c 1").unwrap();
    let on_disk: Vec<String> = s.load().saved.into_iter().map(|q| q.connection_id).collect();
    assert_eq!(on_disk, vec!["c.2"]);
}

#[test]
fn a_library_written_before_stamps_existed_still_loads() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("pg_queries.json");
    std::fs::write(&path, r#"{ "history": {}, "saved": [
        { "id": "a", "name": "Legacy", "connectionId": "c1", "sql": "SELECT 1", "savedAt": "1" } ] }"#).unwrap();
    let names: Vec<String> = PgQueryLibraryStore::new(path).saved("c1").into_iter().map(|q| q.name).collect();
    assert_eq!(names, vec!["Legacy"]);
}
