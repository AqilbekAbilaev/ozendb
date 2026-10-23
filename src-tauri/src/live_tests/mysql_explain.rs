//! Live tests of MySQL's Explain, against the server `mysql.rs` describes.

use std::time::Duration;

use super::mysql::{connect, password, run, test_config, SKIP};
use super::mysql_browse::{pool, quoted};
use crate::commands::explain_mysql_sql;
use crate::error::AppError;
use crate::mysql::uri::build_options;
use crate::storage::ConnectionConfig;
use serde_json::Value;
use sqlx::mysql::MySqlPoolOptions;

const LIMIT: Duration = Duration::from_secs(60);

/// A database of its own per test: owners, and the pets each owns, found by an index.
async fn database(config: &ConnectionConfig, name: &str) -> String {
    let database = quoted(name);
    let mut admin = connect(config, "").await;
    for statement in [
        format!("DROP DATABASE IF EXISTS {database}"),
        format!("CREATE DATABASE {database}"),
        format!("CREATE TABLE {database}.owners (id INT PRIMARY KEY, name VARCHAR(40))"),
        format!("CREATE TABLE {database}.pets (id INT PRIMARY KEY, owner_id INT, kind VARCHAR(20), KEY by_owner (owner_id))"),
        format!("INSERT INTO {database}.owners VALUES (1, 'Åsa'), (2, 'Bo'), (3, 'Cy')"),
        format!("INSERT INTO {database}.pets VALUES (1, 1, 'cat'), (2, 1, 'dog'), (3, 2, 'cat'), (4, 3, 'fish')"),
    ] {
        run(&mut admin, &statement).await;
    }
    database
}

async fn drop_database(config: &ConnectionConfig, database: &str) {
    run(&mut connect(config, "").await, &format!("DROP DATABASE {database}")).await;
}

async fn pets(config: &ConnectionConfig, database: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {database}.pets"))).fetch_one(&mut connect(config, "").await).await.unwrap()
}

/// Every step's `operation`, depth-first.
fn operations(node: &Value) -> Vec<String> {
    let children = node["inputs"].as_array().into_iter().flatten();
    std::iter::once(node["operation"].as_str().unwrap_or_default().to_string()).chain(children.flat_map(operations)).collect()
}

#[tokio::test]
async fn a_select_is_explained_with_the_rows_and_times_it_really_took() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it explain ü").await;
    let pool = pool(&config).await;
    let sql = format!(
        "SELECT o.name, COUNT(*) FROM {database}.owners o JOIN {database}.pets p ON p.owner_id = o.id \
         WHERE o.id IN (SELECT owner_id FROM {database}.pets WHERE kind = 'cat') GROUP BY o.name ORDER BY 2 DESC;"
    );
    let plan = explain_mysql_sql(&pool, &sql, false, LIMIT).await.unwrap();
    assert!(plan["actual_last_row_ms"].is_number(), "{plan}");
    assert_eq!(plan["actual_rows"], 2.0, "{plan}");
    let steps = operations(&plan);
    assert!(steps.iter().any(|s| s.contains("using by_owner")), "{steps:?}");
    assert!(steps[0].starts_with("Sort"), "{steps:?}");
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn a_union_is_explained_as_its_two_halves() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it explain union").await;
    let pool = pool(&config).await;
    let sql = format!("SELECT name FROM {database}.owners UNION SELECT kind FROM {database}.pets");
    let plan = explain_mysql_sql(&pool, &sql, false, LIMIT).await.unwrap();
    let steps = operations(&plan);
    assert!(steps.iter().any(|s| s.contains("union")), "{steps:?}");
    assert_eq!(steps.iter().filter(|s| s.starts_with("Table scan")).count(), 3, "{steps:?}");
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn a_write_is_explained_without_running() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it explain delete").await;
    let pool = pool(&config).await;
    let joined = format!("UPDATE {database}.pets p JOIN {database}.owners o ON o.id = p.owner_id SET p.kind = 'owl' WHERE o.name = 'Åsa'");
    let plan = explain_mysql_sql(&pool, &joined, false, LIMIT).await.unwrap();
    assert!(plan["operation"].as_str().unwrap().starts_with("Update"), "{plan}");
    assert!(plan["actual_rows"].is_null(), "{plan}");
    let single = explain_mysql_sql(&pool, &format!("DELETE FROM {database}.pets WHERE owner_id = 1"), false, LIMIT).await.unwrap_err();
    assert!(single.to_string().contains("as steps"), "{single}");
    let with = format!("WITH x AS (SELECT 1 AS n) DELETE FROM {database}.pets WHERE id IN (SELECT n FROM x)");
    let plan = explain_mysql_sql(&pool, &with, false, LIMIT).await.unwrap();
    assert!(plan["actual_rows"].is_null(), "{plan}");
    assert_eq!(pets(&config, &database).await, 4);
    let owls: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {database}.pets WHERE kind = 'owl'"))).fetch_one(&mut connect(&config, "").await).await.unwrap();
    assert_eq!(owls, 0);
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn a_select_whose_function_writes_is_refused_and_writes_nothing() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it explain function").await;
    run(
        &mut connect(&config, "").await,
        &format!("CREATE FUNCTION {database}.adopt() RETURNS INT DETERMINISTIC MODIFIES SQL DATA BEGIN INSERT INTO {database}.pets VALUES (9, 2, 'owl'); RETURN 1; END"),
    )
    .await;
    let pool = pool(&config).await;
    let refused = explain_mysql_sql(&pool, &format!("SELECT {database}.adopt()"), false, LIMIT).await.unwrap_err();
    assert!(refused.to_string().contains("READ ONLY"), "{refused}");
    assert_eq!(pets(&config, &database).await, 4);
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn more_than_one_statement_is_refused() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let pool = pool(&config).await;
    let refused = explain_mysql_sql(&pool, "SELECT 1; SELECT 2", false, LIMIT).await.unwrap_err();
    assert!(refused.to_string().contains("one statement"), "{refused}");
}

#[tokio::test]
async fn a_query_past_the_time_limit_is_stopped() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let pool = pool(&config).await;
    let stopped = explain_mysql_sql(&pool, "SELECT SLEEP(5)", false, Duration::from_millis(300)).await.unwrap_err();
    assert!(matches!(stopped, AppError::TimedOut), "{stopped}");
}

#[tokio::test]
async fn waiting_for_a_session_counts_against_the_time_limit() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let pool = MySqlPoolOptions::new().max_connections(1).connect_with(build_options(&config, password().as_deref(), "", None).unwrap()).await.unwrap();
    let _held = pool.acquire().await.unwrap();
    let stopped = explain_mysql_sql(&pool, "SELECT 1", false, Duration::from_millis(300)).await.unwrap_err();
    assert!(matches!(stopped, AppError::TimedOut), "{stopped}");
}
