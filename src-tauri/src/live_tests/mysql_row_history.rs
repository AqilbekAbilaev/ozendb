//! Live tests of the MySQL table tab's row history, against the server `mysql.rs` describes.

use super::mysql::{connect, password, run, test_config, SKIP};
use super::mysql_browse::{drop_seeded, quoted, seeded, TABLE};
use crate::commands::{mysql_browse, mysql_save_rows, mysql_undo_row_edit, MySqlRowChanges};
use crate::mysql::session::prepare;
use crate::mysql::uri::build_options;
use crate::postgres::row_history::PgHistoryEntry;
use serde_json::{json, Value};
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;

/// Row 2 of the seeded table as the grid shows it, by column name.
async fn row_two(pool: &MySqlPool, database: &str) -> Vec<(String, Value)> {
    let page = mysql_browse(pool, database, TABLE, &[], &[], None, false, 10, 0).await.unwrap();
    let row = page.rows.into_iter().find(|r| r[0] == json!(2));
    row.map_or_else(Vec::new, |row| page.columns.into_iter().zip(row).collect())
}

fn shown<'a>(row: &'a [(String, Value)], column: &str) -> &'a Value {
    &row.iter().find(|(name, _)| name == column).unwrap().1
}

fn pairs(values: &[(&str, Value)]) -> Value {
    Value::Array(values.iter().map(|(column, value)| json!({ "column": column, "value": value })).collect())
}

/// Saves `set` into row `id` as the table tab does, with the values `loaded` showed before.
async fn edit(pool: &MySqlPool, database: &str, id: u64, set: &[(&str, Value)], loaded: &[(String, Value)]) -> Result<Vec<PgHistoryEntry>, String> {
    let before: Vec<(&str, Value)> = set.iter().map(|(column, _)| (*column, shown(loaded, column).clone())).collect();
    let changes: MySqlRowChanges = serde_json::from_value(json!({
        "inserts": [],
        "updates": [{ "set": pairs(set), "before": pairs(&before), "where": pairs(&[("id key", json!(id))]) }],
        "deletes": [],
    }))
    .unwrap();
    mysql_save_rows(pool, "conn ü", database, TABLE, &changes).await.map_err(|e| e.user_message())
}

async fn undo(pool: &MySqlPool, entry: &PgHistoryEntry) -> Result<(), String> {
    mysql_undo_row_edit(pool, entry).await.map_err(|e| e.user_message())
}

/// Awkward values: NULL to and from, JSON, FLOAT and DOUBLE, DECIMAL, bytes, BIT, TIME
/// and a DATETIME's fraction.
fn awkward() -> Vec<(&'static str, Value)> {
    vec![
        ("ratio", json!(0.1)),
        ("big", json!(1e-7)),
        ("amount", json!("2.5")),
        ("note", json!("now ü")),
        ("at", json!("2024-02-29 13:14:15.120000")),
        ("span", json!("-838:59:59")),
        ("doc", json!({ "b": [1, "x"] })),
        ("raw", json!("0x00FF")),
        ("bits", json!(5)),
        ("status", Value::Null),
    ]
}

#[tokio::test]
async fn an_edit_records_what_the_row_held_and_now_holds_and_undo_restores_it() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it history ведомость types";
    let pool = seeded(&config, name).await;
    let loaded = row_two(&pool, name).await;
    let history = edit(&pool, name, 2, &awkward(), &loaded).await.unwrap();
    let saved = row_two(&pool, name).await;

    let [entry] = history.as_slice() else { panic!("one edit, one entry: {history:?}") };
    assert_eq!((entry.conn_id.as_str(), entry.database.as_str(), entry.schema.as_str(), entry.table.as_str()), ("conn ü", name, "", TABLE));
    assert_eq!(serde_json::to_value(&entry.key).unwrap(), pairs(&[("id key", json!(2))]));
    for change in &entry.changes {
        assert_eq!(&change.before, shown(&loaded, &change.column), "{}", change.column);
        assert_eq!(&change.after, shown(&saved, &change.column), "{}", change.column);
    }
    // What the row holds, not what was sent.
    assert_eq!(shown(&saved, "amount"), &json!("2.5000000000"));

    undo(&pool, entry).await.unwrap();
    assert_eq!(row_two(&pool, name).await, loaded);
    drop_seeded(&config, pool, name).await;
}

#[tokio::test]
async fn undo_is_refused_once_the_row_has_changed_again() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it history ведомость newer";
    let pool = seeded(&config, name).await;
    let history = edit(&pool, name, 2, &awkward(), &row_two(&pool, name).await).await.unwrap();
    let mut other = connect(&config, "").await;
    run(&mut other, &format!("UPDATE {}.{} SET ratio = 0.2 WHERE `id key` = 2", quoted(name), quoted(TABLE))).await;
    let newer = row_two(&pool, name).await;

    assert!(undo(&pool, &history[0]).await.unwrap_err().contains("changed since this edit"));
    assert_eq!(row_two(&pool, name).await, newer);
    drop_seeded(&config, pool, name).await;
}

#[tokio::test]
async fn undo_is_refused_once_the_row_is_gone() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it history ведомость gone";
    let pool = seeded(&config, name).await;
    let history = edit(&pool, name, 2, &[("note", json!("doomed"))], &row_two(&pool, name).await).await.unwrap();
    let mut other = connect(&config, "").await;
    run(&mut other, &format!("DELETE FROM {}.{} WHERE `id key` = 2", quoted(name), quoted(TABLE))).await;

    assert!(undo(&pool, &history[0]).await.unwrap_err().contains("nothing to undo"));
    assert!(row_two(&pool, name).await.is_empty());
    drop_seeded(&config, pool, name).await;
}

#[tokio::test]
async fn a_save_that_fails_records_nothing_and_keeps_the_row() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it history ведомость failed";
    let pool = seeded(&config, name).await;
    let loaded = row_two(&pool, name).await;
    // The edit of row 2 runs, then the missing row 99 fails the save and rolls it back.
    let changes: MySqlRowChanges = serde_json::from_value(json!({
        "inserts": [],
        "updates": [
            { "set": pairs(&[("note", json!("lost"))]), "before": [], "where": pairs(&[("id key", json!(2))]) },
            { "set": pairs(&[("note", json!("lost"))]), "before": [], "where": pairs(&[("id key", json!(99))]) },
        ],
        "deletes": [],
    }))
    .unwrap();
    assert!(mysql_save_rows(&pool, "conn ü", name, TABLE, &changes).await.is_err());
    assert_eq!(row_two(&pool, name).await, loaded);
    drop_seeded(&config, pool, name).await;
}

#[tokio::test]
async fn an_edit_that_changes_the_primary_key_is_undone_by_its_new_key() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it history ведомость key";
    let pool = seeded(&config, name).await;
    let loaded = row_two(&pool, name).await;
    let history = edit(&pool, name, 2, &[("id key", json!(7)), ("note", json!("moved"))], &loaded).await.unwrap();
    assert_eq!(serde_json::to_value(&history[0].key).unwrap(), pairs(&[("id key", json!(7))]));

    undo(&pool, &history[0]).await.unwrap();
    assert_eq!(row_two(&pool, name).await, loaded);
    let keys: Vec<Value> = mysql_browse(&pool, name, TABLE, &[], &[], None, false, 10, 0).await.unwrap().rows.into_iter().map(|r| r[0].clone()).collect();
    assert!(!keys.contains(&json!(7)), "{keys:?}");
    drop_seeded(&config, pool, name).await;
}

#[tokio::test]
async fn a_read_only_session_refuses_the_undo() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it history ведомость read only";
    let pool = seeded(&config, name).await;
    let history = edit(&pool, name, 2, &[("note", json!("kept"))], &row_two(&pool, name).await).await.unwrap();
    let read_only = MySqlPoolOptions::new()
        .after_connect(|connection, _| Box::pin(prepare(connection, true)))
        .connect_with(build_options(&config, password().as_deref(), "", None).unwrap())
        .await
        .unwrap();
    let refusal = undo(&read_only, &history[0]).await.unwrap_err();
    read_only.close().await;
    assert!(refusal.contains("READ ONLY"), "{refusal}");
    assert_eq!(shown(&row_two(&pool, name).await, "note"), &json!("kept"));
    drop_seeded(&config, pool, name).await;
}
