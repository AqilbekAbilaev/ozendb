use super::*;
use tempfile::tempdir;

fn store() -> (tempfile::TempDir, PgRowHistoryStore) {
    let dir = tempdir().unwrap();
    let path = dir.path().join("pg_row_history.json");
    let store = PgRowHistoryStore::new(path);
    (dir, store)
}

fn entry(conn_id: &str, database: &str, schema: &str, table: &str) -> PgHistoryEntry {
    PgHistoryEntry {
        id: uuid::Uuid::new_v4().to_string(),
        conn_id: conn_id.to_string(),
        database: database.to_string(),
        schema: schema.to_string(),
        table: table.to_string(),
        at: 0,
        key: vec![ColumnValue { column: String::from("id"), value: serde_json::json!(1) }],
        changes: vec![PgColumnChange {
            column: String::from("name"),
            before: serde_json::json!("old"),
            after: serde_json::json!("new"),
        }],
    }
}

#[test]
fn push_then_list_for_round_trips_newest_first() {
    let (_dir, store) = store();
    store.push(entry("c1", "appdb", "public", "users")).unwrap();
    let second = entry("c1", "appdb", "public", "users");
    let second_id = second.id.clone();
    store.push(second).unwrap();

    let listed = store.list_for("c1", "appdb", "public", "users");
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].id, second_id);
}

#[test]
fn list_for_is_scoped_to_connection_database_schema_and_table() {
    let (_dir, store) = store();
    store.push(entry("c1", "appdb", "public", "users")).unwrap();
    store.push(entry("c1", "otherdb", "public", "users")).unwrap();
    store.push(entry("c1", "appdb", "public", "orders")).unwrap();
    store.push(entry("c2", "appdb", "public", "users")).unwrap();

    assert_eq!(store.list_for("c1", "appdb", "public", "users").len(), 1);
}

#[test]
fn get_finds_by_id_across_every_table() {
    let (_dir, store) = store();
    let e = entry("c1", "appdb", "public", "users");
    let id = e.id.clone();
    store.push(e).unwrap();

    assert!(store.get(&id).is_some());
    assert!(store.get("missing").is_none());
}

#[test]
fn clear_for_removes_only_the_matching_table() {
    let (_dir, store) = store();
    store.push(entry("c1", "appdb", "public", "users")).unwrap();
    store.push(entry("c1", "appdb", "public", "orders")).unwrap();

    store.clear_for("c1", "appdb", "public", "users").unwrap();

    assert_eq!(store.list_for("c1", "appdb", "public", "users").len(), 0);
    assert_eq!(store.list_for("c1", "appdb", "public", "orders").len(), 1);
}

#[test]
fn push_trims_to_the_cap() {
    let (_dir, store) = store();
    for _ in 0..(MAX_ENTRIES + 5) {
        store.push(entry("c1", "appdb", "public", "users")).unwrap();
    }
    assert_eq!(store.load().len(), MAX_ENTRIES);
}
