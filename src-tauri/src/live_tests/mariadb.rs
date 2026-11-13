//! Live tests of what only MariaDB offers (RETURNING, system versioning), against the server
//! `mysql.rs` describes. Each returns early on a MySQL server.

use std::time::Duration;

use super::mysql::{connect, password, run, test_config, SKIP};
use super::mysql_browse::{pool, quoted};
use crate::commands::{mysql_browse, mysql_columns, mysql_save_rows, mysql_tables_columns, run_mysql_sql, MySqlRowChanges};
use crate::mysql::session::{flavor, prepare, Flavor};
use crate::mysql::uri::build_options;
use crate::storage::ConnectionConfig;
use serde_json::json;
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;

const LIMIT: Duration = Duration::from_secs(60);

/// The test server as a MariaDB one, or `None` to skip.
async fn mariadb() -> Option<ConnectionConfig> {
    let Some(config) = test_config() else {
        eprintln!("{SKIP}");
        return None;
    };
    if flavor(&mut connect(&config, "").await).await.unwrap() == Flavor::MariaDb {
        Some(config)
    } else {
        eprintln!("skipping: the server is not MariaDB");
        None
    }
}

/// A database of its own per test, holding a table `t` with an id and a note.
async fn database(config: &ConnectionConfig, name: &str, suffix: &str) -> String {
    let database = quoted(name);
    let mut admin = connect(config, "").await;
    run(&mut admin, &format!("DROP DATABASE IF EXISTS {database}")).await;
    run(&mut admin, &format!("CREATE DATABASE {database}")).await;
    run(&mut admin, &format!("CREATE TABLE {database}.t (id INT PRIMARY KEY, note VARCHAR(20)){suffix}")).await;
    database
}

async fn drop_database(config: &ConnectionConfig, database: &str) {
    run(&mut connect(config, "").await, &format!("DROP DATABASE {database}")).await;
}

async fn count(config: &ConnectionConfig, database: &str, tail: &str) -> i64 {
    let mut admin = connect(config, "").await;
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {database}.t{tail}"))).fetch_one(&mut admin).await.unwrap()
}

async fn read_only_pool(config: &ConnectionConfig) -> MySqlPool {
    MySqlPoolOptions::new()
        .after_connect(|connection, _| Box::pin(prepare(connection, true)))
        .connect_with(build_options(config, password().as_deref(), "", None).unwrap())
        .await
        .unwrap()
}

#[tokio::test]
async fn an_insert_returning_answers_with_the_inserted_rows_and_writes_them() {
    let Some(config) = mariadb().await else { return };
    let database = database(&config, "ozendb it returning insert ü", "").await;
    let sql = format!("INSERT INTO {database}.t VALUES (1, 'a'), (2, 'b') RETURNING id, note");
    let results = run_mysql_sql(&pool(&config).await, &sql, false, None, LIMIT).await.unwrap();
    assert_eq!((results[0].columns.clone(), results[0].rows.clone()), (vec![String::from("id"), String::from("note")], vec![vec![json!(1), json!("a")], vec![json!(2), json!("b")]]));
    assert_eq!(count(&config, &database, "").await, 2);
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn a_delete_returning_answers_with_the_deleted_rows_and_deletes_them() {
    let Some(config) = mariadb().await else { return };
    let database = database(&config, "ozendb it returning delete ü", "").await;
    run(&mut connect(&config, "").await, &format!("INSERT INTO {database}.t VALUES (1, 'a'), (2, 'b'), (3, 'c')")).await;
    let sql = format!("DELETE FROM {database}.t WHERE id > 1 RETURNING id, note");
    let results = run_mysql_sql(&pool(&config).await, &sql, false, None, LIMIT).await.unwrap();
    assert_eq!(results[0].rows, [vec![json!(2), json!("b")], vec![json!(3), json!("c")]]);
    assert_eq!(count(&config, &database, "").await, 1);
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn a_read_only_connection_refuses_an_insert_returning_and_writes_nothing() {
    let Some(config) = mariadb().await else { return };
    let database = database(&config, "ozendb it returning read only ü", "").await;
    let sql = format!("INSERT INTO {database}.t VALUES (1, 'a') RETURNING id");
    assert_eq!(run_mysql_sql(&read_only_pool(&config).await, &sql, true, None, LIMIT).await.unwrap_err().code(), "command");
    assert_eq!(count(&config, &database, "").await, 0);
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn a_system_versioned_table_browses_and_lists_only_its_own_columns() {
    let Some(config) = mariadb().await else { return };
    let database = database(&config, "ozendb it versioned columns ü", " WITH SYSTEM VERSIONING").await;
    run(&mut connect(&config, "").await, &format!("INSERT INTO {database}.t VALUES (1, 'a')")).await;
    let pool = pool(&config).await;
    let name = database.trim_matches('`');
    let page = mysql_browse(&pool, name, "t", &[], &[], None, false, 10, 0).await.unwrap();
    let listed: Vec<String> = mysql_columns(&pool, name, "t").await.unwrap().into_iter().map(|c| c.name).collect();
    let all: Vec<String> = mysql_tables_columns(&pool, &[(name, "t")]).await.unwrap().remove(0).into_iter().map(|c| c.name).collect();
    assert_eq!((page.columns, page.rows, listed, all), (vec![String::from("id"), String::from("note")], vec![vec![json!(1), json!("a")]], vec![String::from("id"), String::from("note")], vec![String::from("id"), String::from("note")]));
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn a_saved_edit_of_a_system_versioned_table_keeps_the_old_version_in_its_history() {
    let Some(config) = mariadb().await else { return };
    let database = database(&config, "ozendb it versioned save ü", " WITH SYSTEM VERSIONING").await;
    run(&mut connect(&config, "").await, &format!("INSERT INTO {database}.t VALUES (1, 'a')")).await;
    let pool = pool(&config).await;
    let row = |note: &str| json!([{ "column": "note", "value": note }]);
    let edit = json!({ "inserts": [], "deletes": [], "updates": [{ "set": row("b"), "before": row("a"), "where": [{ "column": "id", "value": 1 }] }] });
    let changes: MySqlRowChanges = serde_json::from_value(edit).unwrap();
    mysql_save_rows(&pool, "conn", database.trim_matches('`'), "t", &changes).await.unwrap();
    assert_eq!((count(&config, &database, "").await, count(&config, &database, " FOR SYSTEM_TIME ALL").await), (1, 2));
    drop_database(&config, &database).await;
}
