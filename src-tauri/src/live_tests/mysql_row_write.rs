//! Live tests of saving the MySQL table tab's rows, against the server `mysql.rs` describes.

use super::mysql::{connect, password, run, test_config, SKIP};
use super::mysql_browse::{drop_seeded, quoted, seeded, TABLE};
use crate::commands::{mysql_browse, mysql_save_rows, MySqlRowChanges};
use crate::error::AppError;
use crate::mysql::session::prepare;
use crate::mysql::uri::build_options;
use serde_json::{json, Value};
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;

/// The changes as the table tab sends them, `before` values and all.
fn changes(value: Value) -> MySqlRowChanges {
    serde_json::from_value(value).unwrap()
}

/// `(column, value)` pairs as the tab's `{ column, value }` list.
fn row(pairs: &[(&str, Value)]) -> Value {
    Value::Array(pairs.iter().map(|(column, value)| json!({ "column": column, "value": value })).collect())
}

async fn page(pool: &MySqlPool, database: &str, table: &str) -> Vec<Vec<Value>> {
    mysql_browse(pool, database, table, &[], &[], None, false, 10, 0).await.unwrap().rows
}

fn refusal<T: std::fmt::Debug>(result: Result<T, AppError>) -> String {
    result.expect_err("the save is refused").user_message()
}

#[tokio::test]
async fn every_type_saves_back_exactly_what_the_grid_shows() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it save ведомость types";
    let pool = seeded(&config, name).await;
    let columns = mysql_browse(&pool, name, TABLE, &[], &[], None, false, 1, 0).await.unwrap().columns;
    let before = page(&pool, name, TABLE).await;
    let shown = before.iter().find(|r| r[0] == json!("18446744073709551615")).unwrap().clone();
    let pairs = |from: usize| columns.iter().zip(&shown).skip(from).map(|(c, v)| (c.as_str(), v.clone())).collect::<Vec<_>>();
    let mut copy = pairs(1);
    copy.insert(0, ("id key", json!(3)));
    let nulls: Vec<(&str, Value)> = columns.iter().skip(1).filter(|c| *c != "name `x`").map(|c| (c.as_str(), Value::Null)).collect();
    let saved = changes(json!({
        "inserts": [row(&copy)],
        "updates": [
            { "set": row(&pairs(1)), "before": row(&pairs(1)), "where": row(&[("id key", shown[0].clone())]) },
            { "set": row(&nulls), "before": [], "where": row(&[("id key", json!(2))]) },
        ],
        "deletes": [],
    }));
    mysql_save_rows(&pool, "conn", name, TABLE, &saved).await.unwrap();

    let after = page(&pool, name, TABLE).await;
    let mut copied = shown.clone();
    copied[0] = json!(3);
    assert_eq!(after.iter().find(|r| r[0] == json!(3)), Some(&copied));
    assert_eq!(after.iter().find(|r| r[0] == shown[0]), Some(&shown));
    let emptied = after.iter().find(|r| r[0] == json!(2)).unwrap();
    let mut expected = vec![Value::Null; columns.len()];
    (expected[0], expected[6]) = (json!(2), json!("abc"));
    assert_eq!(emptied, &expected);
    drop_seeded(&config, pool, name).await;
}

#[tokio::test]
async fn a_key_past_2_to_the_53_deletes_its_own_row_and_not_its_neighbour() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it save ведомость big keys";
    let pool = seeded(&config, name).await;
    let neighbour = row(&[("id key", json!("9007199254740992")), ("name `x`", json!("neighbour"))]);
    mysql_save_rows(&pool, "conn", name, TABLE, &changes(json!({ "inserts": [neighbour], "updates": [], "deletes": [] }))).await.unwrap();

    let gone = changes(json!({ "inserts": [], "updates": [], "deletes": [row(&[("id key", json!("9007199254740993"))])] }));
    mysql_save_rows(&pool, "conn", name, TABLE, &gone).await.unwrap();
    let keys: Vec<Value> = page(&pool, name, TABLE).await.into_iter().map(|r| r[0].clone()).collect();
    assert_eq!(keys, [json!(2), json!("9007199254740992"), json!("18446744073709551615")]);
    drop_seeded(&config, pool, name).await;
}

/// A database holding one table keyed by a TIMESTAMP and a binary code together, and one
/// with no primary key.
async fn seeded_keys(config: &crate::storage::ConnectionConfig, name: &str) -> MySqlPool {
    let database = quoted(name);
    let mut admin = connect(config, "").await;
    for statement in [
        format!("DROP DATABASE IF EXISTS {database}"),
        format!("CREATE DATABASE {database}"),
        format!(
            "CREATE TABLE {database}.`visits ü` (at TIMESTAMP(3), `code ``x``` VARBINARY(2), note VARCHAR(20), \
             PRIMARY KEY (at, `code ``x```))"
        ),
        format!(
            "INSERT INTO {database}.`visits ü` VALUES ('2024-06-30 18:59:59.120', 0x0A0B, 'first'), \
             ('2024-06-30 18:59:59.120', 0x0A0C, 'second'), ('2024-07-01 00:00:00.000', 0x0A0B, 'third')"
        ),
        format!("CREATE TABLE {database}.`log` (line TEXT)"),
        format!("INSERT INTO {database}.`log` VALUES ('kept')"),
    ] {
        run(&mut admin, &statement).await;
    }
    super::mysql_browse::pool(config).await
}

#[tokio::test]
async fn a_composite_key_finds_each_row_by_every_part() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it save ведомость composite";
    let pool = seeded_keys(&config, name).await;
    let key = |code: &str| row(&[("at", json!(super::mysql::shown_at("2024-06-30 18:59:59.120"))), ("code `x`", json!(code))]);
    let saved = changes(json!({
        "inserts": [],
        "updates": [{ "set": row(&[("note", json!("edited"))]), "before": [], "where": key("0x0A0B") }],
        "deletes": [key("0x0A0C")],
    }));
    mysql_save_rows(&pool, "conn", name, "visits ü", &saved).await.unwrap();
    let notes: Vec<Value> = page(&pool, name, "visits ü").await.into_iter().map(|r| r[2].clone()).collect();
    assert_eq!(notes, [json!("edited"), json!("third")]);
    drop_seeded(&config, pool, name).await;
}

#[tokio::test]
async fn a_table_without_a_primary_key_is_refused_and_left_as_it_was() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it save ведомость keyless";
    let pool = seeded_keys(&config, name).await;
    let saved = changes(json!({
        "inserts": [row(&[("line", json!("added"))])],
        "updates": [{ "set": row(&[("line", json!("edited"))]), "before": [], "where": row(&[("line", json!("kept"))]) }],
        "deletes": [],
    }));
    assert!(refusal(mysql_save_rows(&pool, "conn", name, "log", &saved).await).contains("no primary key"));
    assert_eq!(page(&pool, name, "log").await, [vec![json!("kept")]]);
    drop_seeded(&config, pool, name).await;
}

#[tokio::test]
async fn a_row_changed_by_someone_else_saves_nothing() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it save ведомость conflict";
    let pool = seeded(&config, name).await;
    // Another session moves row 2 away after the tab loaded it.
    let mut other = connect(&config, "").await;
    run(&mut other, &format!("UPDATE {}.{} SET `id key` = 20 WHERE `id key` = 2", quoted(name), quoted(TABLE))).await;
    let saved = changes(json!({
        "inserts": [row(&[("id key", json!(4))])],
        "updates": [{ "set": row(&[("note", json!("mine"))]), "before": [], "where": row(&[("id key", json!(2))]) }],
        "deletes": [],
    }));
    let place = format!("table \"{TABLE}\" of database \"{name}\"");
    assert_eq!(
        refusal(mysql_save_rows(&pool, "conn", name, TABLE, &saved).await),
        format!("A row in {place} was deleted, or its primary key changed, since it was loaded.")
    );
    let gone = changes(json!({ "inserts": [], "updates": [], "deletes": [row(&[("id key", json!(2))])] }));
    assert_eq!(
        refusal(mysql_save_rows(&pool, "conn", name, TABLE, &gone).await),
        format!("Some rows in {place} were already deleted, or their primary key changed, since they were loaded.")
    );
    let keys: Vec<Value> = page(&pool, name, TABLE).await.into_iter().map(|r| r[0].clone()).collect();
    assert_eq!(keys, [json!(20), json!("9007199254740993"), json!("18446744073709551615")]);
    drop_seeded(&config, pool, name).await;
}

#[tokio::test]
async fn more_deletes_than_one_statement_binds_are_all_counted() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it save ведомость many deletes";
    let pool = seeded(&config, name).await;
    // Row 2 and 65,536 rows that were never there: refused for those, not by the server's limit.
    let deletes: Vec<Value> = (2..65_538).map(|id| row(&[("id key", json!(id))])).collect();
    let saved = changes(json!({ "inserts": [], "updates": [], "deletes": deletes }));
    assert!(refusal(mysql_save_rows(&pool, "conn", name, TABLE, &saved).await).contains("already deleted"));
    assert_eq!(page(&pool, name, TABLE).await.len(), 3);
    drop_seeded(&config, pool, name).await;
}

#[tokio::test]
async fn a_read_only_session_refuses_the_save() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it save ведомость read only";
    let writable = seeded(&config, name).await;
    let read_only = MySqlPoolOptions::new()
        .after_connect(|connection, _| Box::pin(prepare(connection, true)))
        .connect_with(build_options(&config, password().as_deref(), "", None).unwrap())
        .await
        .unwrap();
    let saved = changes(json!({ "inserts": [row(&[("id key", json!(4))])], "updates": [], "deletes": [] }));
    assert!(refusal(mysql_save_rows(&read_only, "conn", name, TABLE, &saved).await).contains("READ ONLY"));
    read_only.close().await;
    assert_eq!(page(&writable, name, TABLE).await.len(), 3);
    drop_seeded(&config, writable, name).await;
}
