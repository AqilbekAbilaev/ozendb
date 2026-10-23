//! Live tests of the MySQL SQL tab: scripts, Cancel, the time limit, a read-only
//! connection and held transactions, against the server `mysql.rs` describes.

use std::time::{Duration, Instant};

use super::mysql::{connect, password, run, shown_at, test_config, SKIP};
use super::mysql_browse::{pool, quoted};
use crate::commands::{cancel_mysql_run, run_mysql_sql, MySqlTransactions};
use crate::error::AppError;
use crate::mysql::session::prepare;
use crate::mysql::uri::build_options;
use crate::storage::ConnectionConfig;
use serde_json::json;
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;

const LIMIT: Duration = Duration::from_secs(60);

/// A database of its own per test, holding an empty table `t` with an id and a note.
async fn database(config: &ConnectionConfig, name: &str) -> String {
    let database = quoted(name);
    let mut admin = connect(config, "").await;
    run(&mut admin, &format!("DROP DATABASE IF EXISTS {database}")).await;
    run(&mut admin, &format!("CREATE DATABASE {database}")).await;
    run(&mut admin, &format!("CREATE TABLE {database}.t (id INT PRIMARY KEY, note VARCHAR(20))")).await;
    database
}

async fn drop_database(config: &ConnectionConfig, database: &str) {
    run(&mut connect(config, "").await, &format!("DROP DATABASE {database}")).await;
}

async fn count(config: &ConnectionConfig, database: &str) -> i64 {
    let mut admin = connect(config, "").await;
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {database}.t"))).fetch_one(&mut admin).await.unwrap()
}

async fn read_only_pool(config: &ConnectionConfig) -> MySqlPool {
    MySqlPoolOptions::new()
        .after_connect(|connection, _| Box::pin(prepare(connection, true)))
        .connect_with(build_options(config, password().as_deref(), "", None).unwrap())
        .await
        .unwrap()
}

#[tokio::test]
async fn a_script_runs_each_statement_and_answers_with_each_result() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it script ü").await;
    let pool = pool(&config).await;
    let script = format!(
        "USE {database};\nCREATE TABLE flags (f TINYINT(1) UNSIGNED, at TIMESTAMP NULL);\n\
         INSERT INTO flags VALUES (251, '2024-01-01 00:00:00'), (1, NULL); -- a; comment\n\
         SELECT f, at, 'x;y' AS `semi;colon` FROM flags ORDER BY f DESC; SELECT f FROM flags WHERE f > 999"
    );
    let results = run_mysql_sql(&pool, &script, false, None, LIMIT).await.unwrap();
    assert_eq!(results.len(), 5);
    assert_eq!(results[2].rows_affected, Some(2));
    assert_eq!(results[3].columns, ["f", "at", "semi;colon"]);
    assert_eq!(results[3].rows, [vec![json!(251), json!(shown_at("2024-01-01 00:00:00")), json!("x;y")], vec![json!(true), json!(null), json!("x;y")]]);
    assert_eq!((results[4].columns.as_slice(), results[4].rows.len(), results[4].rows_affected), (["f".to_string()].as_slice(), 0, None));
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn a_failing_statement_stops_the_script_and_is_named() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it failing").await;
    let pool = pool(&config).await;
    let script = format!("INSERT INTO {database}.t VALUES (1, 'a'); SELECT nope FROM {database}.t; INSERT INTO {database}.t VALUES (2, 'b')");
    let err = run_mysql_sql(&pool, &script, false, None, LIMIT).await.unwrap_err();
    assert_eq!(err.code(), "command");
    assert!(err.user_message().starts_with("Statement 2 failed (the ones before it ran): Unknown column 'nope'"), "{}", err.user_message());
    assert_eq!(count(&config, &database).await, 1);
    drop_database(&config, &database).await;
}

async fn cancelled(pool: &MySqlPool, sql: String, run_id: &str) -> (AppError, Duration) {
    let running = {
        let (pool, run_id) = (pool.clone(), run_id.to_string());
        tokio::spawn(async move { run_mysql_sql(&pool, &sql, false, Some(&run_id), LIMIT).await })
    };
    tokio::time::sleep(Duration::from_millis(500)).await;
    let started = Instant::now();
    assert!(cancel_mysql_run(pool, run_id).await.unwrap(), "a running query is found and cancelled");
    let err = tokio::time::timeout(Duration::from_secs(10), running).await.unwrap().unwrap().unwrap_err();
    (err, started.elapsed())
}

#[tokio::test]
async fn cancel_stops_a_sleeping_select() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let pool = pool(&config).await;
    let (err, took) = cancelled(&pool, String::from("SELECT SLEEP(30)"), "mysql-run-sleep").await;
    assert_eq!((err.code(), err.user_message().as_str()), ("cancelled", "The query was cancelled."));
    assert!(took < Duration::from_secs(5), "{took:?}");
    assert!(!cancel_mysql_run(&pool, "mysql-run-sleep").await.unwrap(), "a finished run cancels nothing");
}

#[tokio::test]
async fn cancel_stops_a_long_update_and_the_rest_of_its_script() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it cancel").await;
    run(&mut connect(&config, "").await, &format!("INSERT INTO {database}.t VALUES (1, 'a')")).await;
    let pool = pool(&config).await;
    let script = format!("UPDATE {database}.t SET note = SLEEP(30); INSERT INTO {database}.t VALUES (2, 'b')");
    let (err, took) = cancelled(&pool, script, "mysql-run-update").await;
    assert_eq!(err.code(), "cancelled");
    assert!(took < Duration::from_secs(5), "{took:?}");
    assert_eq!(count(&config, &database).await, 1);
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn a_statement_that_is_not_a_select_stops_at_the_time_limit() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let pool = pool(&config).await;
    let started = Instant::now();
    let err = run_mysql_sql(&pool, "DO SLEEP(30)", false, None, Duration::from_millis(500)).await.unwrap_err();
    assert_eq!((err.code(), err.user_message().as_str()), ("cancelled", "The query ran past its time limit and was stopped."));
    assert!(started.elapsed() < Duration::from_secs(5), "{:?}", started.elapsed());
}

#[tokio::test]
async fn a_read_only_connection_refuses_to_lift_its_lock_and_stays_locked() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it read only").await;
    let pool = read_only_pool(&config).await;
    for lift in ["SET SESSION transaction_read_only = OFF", "SET SESSION TRANSACTION READ WRITE", "START TRANSACTION READ WRITE"] {
        let script = format!("{lift}; INSERT INTO {database}.t VALUES (1, 'a')");
        assert_eq!(run_mysql_sql(&pool, &script, true, None, LIMIT).await.unwrap_err().code(), "validation", "{lift}");
    }
    let err = run_mysql_sql(&pool, &format!("INSERT INTO {database}.t VALUES (1, 'a')"), true, None, LIMIT).await.unwrap_err();
    assert_eq!(err.code(), "command");
    assert_eq!(count(&config, &database).await, 0);
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn a_read_only_connection_refuses_a_prepared_statement_that_would_lift_its_lock() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it prepared ü").await;
    run(&mut connect(&config, "").await, &format!("INSERT INTO {database}.t VALUES (1, 'a')")).await;
    let pool = read_only_pool(&config).await;
    let script = format!("PREPARE s FROM 'SET SESSION transaction_read_only = OFF'; EXECUTE s; DELETE FROM {database}.t;");
    assert_eq!(run_mysql_sql(&pool, &script, true, None, LIMIT).await.unwrap_err().code(), "validation");
    assert_eq!(count(&config, &database).await, 1);
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn a_read_only_connection_locks_its_session_again_before_each_statement() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it relock").await;
    let mut admin = connect(&config, "").await;
    run(&mut admin, &format!("INSERT INTO {database}.t VALUES (1, 'a')")).await;
    run(&mut admin, &format!("CREATE PROCEDURE {database}.`lift ü`() SET SESSION transaction_read_only = OFF")).await;
    let pool = read_only_pool(&config).await;
    let err = run_mysql_sql(&pool, &format!("CALL {database}.`lift ü`(); DELETE FROM {database}.t"), true, None, LIMIT).await.unwrap_err();
    assert!(err.user_message().contains("read-only") || err.user_message().contains("READ ONLY"), "{}", err.user_message());
    assert_eq!(count(&config, &database).await, 1);
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn what_a_run_sets_in_its_session_ends_with_the_run() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let pool = pool(&config).await;
    run_mysql_sql(&pool, "SET time_zone = '+05:00'", false, None, LIMIT).await.unwrap();
    let results = run_mysql_sql(&pool, "SELECT @@time_zone", false, None, LIMIT).await.unwrap();
    assert_eq!(results[0].rows, [vec![json!("+00:00")]]);
}

#[tokio::test]
async fn a_held_transaction_spans_runs_until_it_is_committed_or_rolled_back() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it transaction").await;
    let pool = pool(&config).await;
    let txs = MySqlTransactions::default();
    for (tx_id, commit, kept) in [("tx rolled back", false, 0), ("tx committed", true, 2)] {
        txs.begin(&pool, tx_id, false).await.unwrap();
        txs.run(tx_id, &pool, &format!("INSERT INTO {database}.t VALUES (1, 'a')"), false, None).await.unwrap();
        txs.run(tx_id, &pool, &format!("INSERT INTO {database}.t VALUES (2, 'b')"), false, None).await.unwrap();
        assert_eq!(count(&config, &database).await, 0, "nothing shows outside the transaction before it ends");
        txs.finish(tx_id, commit).await.unwrap();
        assert_eq!(count(&config, &database).await, kept);
        assert_eq!(txs.finish(tx_id, commit).await.unwrap_err().to_string(), "That transaction has already ended.");
    }
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn a_read_only_connection_holds_a_read_only_transaction() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it read only tx").await;
    let pool = read_only_pool(&config).await;
    let txs = MySqlTransactions::default();
    txs.begin(&pool, "tx", true).await.unwrap();
    let err = txs.run("tx", &pool, &format!("INSERT INTO {database}.t VALUES (1, 'a')"), true, None).await.unwrap_err();
    assert_eq!(err.code(), "command");
    txs.finish("tx", true).await.unwrap();
    assert_eq!(count(&config, &database).await, 0);
    drop_database(&config, &database).await;
}
