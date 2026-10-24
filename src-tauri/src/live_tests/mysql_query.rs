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
async fn a_call_answers_with_every_result_set_its_procedure_returns() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it call ü").await;
    let mut admin = connect(&config, "").await;
    run(&mut admin, &format!(
        "CREATE PROCEDURE {database}.`two sets ü`() BEGIN INSERT INTO {database}.t VALUES (1, 'a'), (2, 'b'); \
         SELECT id FROM {database}.t ORDER BY id; SELECT 'x;y' AS `note ü`, 3 AS n; END"
    )).await;
    run(&mut admin, &format!("CREATE PROCEDURE {database}.`no sets`() DELETE FROM {database}.t WHERE id = 2")).await;
    let pool = pool(&config).await;
    let results = run_mysql_sql(&pool, &format!("CALL {database}.`two sets ü`(); CALL {database}.`no sets`(); SELECT 4"), false, None, LIMIT).await.unwrap();
    let shown: Vec<_> = results.iter().map(|r| (r.statement, r.columns.clone(), r.rows.clone(), r.rows_affected)).collect();
    assert_eq!(
        shown,
        [
            (0, vec![String::from("id")], vec![vec![json!(1)], vec![json!(2)]], None),
            (0, vec![String::from("note ü"), String::from("n")], vec![vec![json!("x;y"), json!(3)]], None),
            (1, vec![], vec![], Some(1)),
            (2, vec![String::from("4")], vec![vec![json!(4)]], None),
        ]
    );
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn text_with_a_binary_collation_reads_as_text_and_binary_strings_as_hex() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it collation").await;
    run(&mut connect(&config, "").await, &format!("CREATE TABLE {database}.bin (word VARCHAR(10) COLLATE utf8mb4_bin, raw VARBINARY(4))")).await;
    let pool = pool(&config).await;
    let script = format!(
        "INSERT INTO {database}.bin VALUES ('Straße', 'ab'); \
         SELECT word, raw, 'ü;' COLLATE utf8mb4_bin, CAST('x' AS BINARY) FROM {database}.bin"
    );
    let results = run_mysql_sql(&pool, &script, false, None, LIMIT).await.unwrap();
    assert_eq!(results[1].rows, [vec![json!("Straße"), json!("0x6162"), json!("ü;"), json!("0x78")]]);
    drop_database(&config, &database).await;
}

/// Ten to the `power` rows, made on the server as they are read.
fn many_rows(power: usize) -> String {
    let ten = "(SELECT 0 d UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 \
               UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)";
    format!("SELECT 'Straße ü' FROM {}", (0..power).map(|i| format!("{ten} d{i}")).collect::<Vec<_>>().join(", "))
}

#[tokio::test]
async fn a_run_of_its_own_stops_reading_a_result_at_the_row_cap() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let pool = pool(&config).await;
    let started = Instant::now();
    let results = run_mysql_sql(&pool, &format!("{}; {}", many_rows(5), many_rows(7)), false, None, LIMIT).await.unwrap();
    assert!((results[0].truncated, results[1].truncated) == (true, true));
    assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
}

#[tokio::test]
async fn a_held_transaction_reads_past_the_row_cap_and_stays_usable() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let pool = pool(&config).await;
    let txs = MySqlTransactions::default();
    txs.begin(&pool, "tx cap", false).await.unwrap();
    let results = txs.run("tx cap", &pool, &format!("{}; SELECT 2", many_rows(5)), false, None).await.unwrap();
    assert!(results[0].truncated);
    assert_eq!(results[1].rows, [vec![json!(2)]]);
    txs.finish("tx cap", false).await.unwrap();
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

/// A pool with room for one session only, as a full pool would leave it.
async fn pool_of_one(config: &ConnectionConfig) -> MySqlPool {
    MySqlPoolOptions::new()
        .max_connections(1)
        .after_connect(|connection, _| Box::pin(prepare(connection, false)))
        .connect_with(build_options(config, password().as_deref(), "", None).unwrap())
        .await
        .unwrap()
}

#[tokio::test]
async fn cancel_stops_a_run_still_waiting_for_its_session() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it early cancel").await;
    let pool = pool_of_one(&config).await;
    let busy = pool.acquire().await.unwrap();
    let running = {
        let (pool, sql) = (pool.clone(), format!("INSERT INTO {database}.t VALUES (1, 'a')"));
        tokio::spawn(async move { run_mysql_sql(&pool, &sql, false, Some("mysql-run-early"), LIMIT).await })
    };
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(cancel_mysql_run(&pool, "mysql-run-early").await.unwrap(), "a run waiting for a session is found and cancelled");
    // The run ends while the session is still held: Cancel ends the wait, not a freed session.
    let err = tokio::time::timeout(Duration::from_secs(5), running).await.expect("Cancel ends the wait").unwrap().unwrap_err();
    drop(busy);
    assert_eq!(err.code(), "cancelled");
    assert_eq!(count(&config, &database).await, 0);
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn cancel_stops_a_statement_even_when_the_pool_is_full() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let pool = pool_of_one(&config).await;
    let txs = std::sync::Arc::new(MySqlTransactions::default());
    txs.begin(&pool, "tx full pool", false).await.unwrap();
    let running = {
        let (txs, pool) = (txs.clone(), pool.clone());
        tokio::spawn(async move { txs.run("tx full pool", &pool, "SELECT SLEEP(30)", false, Some("mysql-run-full")).await })
    };
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(tokio::time::timeout(Duration::from_secs(5), cancel_mysql_run(&pool, "mysql-run-full")).await.unwrap().unwrap());
    let err = tokio::time::timeout(Duration::from_secs(5), running).await.unwrap().unwrap().unwrap_err();
    assert_eq!(err.code(), "cancelled");
    txs.finish("tx full pool", false).await.unwrap();
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

/// A stored function's lift shows in the session's variable but never lets a later
/// statement write; the lock run_on sets again before each statement is a second guard.
#[tokio::test]
async fn a_read_only_connection_stays_locked_after_a_function_lifts_its_lock() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it relock").await;
    let mut admin = connect(&config, "").await;
    run(&mut admin, &format!("INSERT INTO {database}.t VALUES (1, 'a')")).await;
    run(&mut admin, &format!("CREATE FUNCTION {database}.`lift ü`() RETURNS INT DETERMINISTIC NO SQL BEGIN SET SESSION transaction_read_only = OFF; RETURN 1; END")).await;
    let pool = read_only_pool(&config).await;
    let err = run_mysql_sql(&pool, &format!("SELECT {database}.`lift ü`(); DELETE FROM {database}.t"), true, None, LIMIT).await.unwrap_err();
    assert!(err.user_message().contains("read-only") || err.user_message().contains("READ ONLY"), "{}", err.user_message());
    assert_eq!(count(&config, &database).await, 1);
    drop_database(&config, &database).await;
}

/// A procedure that says it only reads can still lift the lock and write: MySQL doesn't
/// hold it to what it declares.
#[tokio::test]
async fn a_read_only_connection_refuses_to_call_a_procedure_even_one_that_says_it_only_reads() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it read only call ü").await;
    let mut admin = connect(&config, "").await;
    run(&mut admin, &format!("INSERT INTO {database}.t VALUES (1, 'a')")).await;
    run(&mut admin, &format!(
        "CREATE PROCEDURE {database}.`only reads ü`() READS SQL DATA BEGIN SET SESSION transaction_read_only = OFF; DELETE FROM {database}.t; END"
    )).await;
    let err = run_mysql_sql(&read_only_pool(&config).await, &format!("CALL {database}.`only reads ü`()"), true, None, LIMIT).await.unwrap_err();
    assert_eq!((err.code(), err.user_message().contains("can't call a stored procedure")), ("validation", true), "{}", err.user_message());
    assert_eq!(count(&config, &database).await, 1);
    run_mysql_sql(&pool(&config).await, &format!("CALL {database}.`only reads ü`()"), false, None, LIMIT).await.unwrap();
    assert_eq!(count(&config, &database).await, 0, "the procedure does write when a writable connection calls it");
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
async fn a_held_transaction_outlasts_a_statement_that_commits_by_itself() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it implicit commit").await;
    let pool = pool(&config).await;
    let txs = MySqlTransactions::default();
    txs.begin(&pool, "tx ddl", false).await.unwrap();
    let script = format!("CREATE TABLE {database}.`other ü` (id INT); INSERT INTO {database}.t VALUES (1, 'a')");
    txs.run("tx ddl", &pool, &script, false, None).await.unwrap();
    txs.finish("tx ddl", false).await.unwrap();
    assert_eq!(count(&config, &database).await, 0);
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn a_deadlock_in_a_held_transaction_says_it_rolled_the_transaction_back() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let database = database(&config, "ozendb it deadlock").await;
    let mut other = connect(&config, "").await;
    run(&mut other, &format!("INSERT INTO {database}.t VALUES (1, 'a'), (2, 'b')")).await;
    let pool = pool(&config).await;
    let txs = std::sync::Arc::new(MySqlTransactions::default());
    txs.begin(&pool, "tx deadlock", false).await.unwrap();
    txs.run("tx deadlock", &pool, &format!("UPDATE {database}.t SET note = 'x' WHERE id = 1"), false, None).await.unwrap();
    // The other session changes more rows, so InnoDB picks the held transaction as the one to roll back.
    run(&mut other, "START TRANSACTION").await;
    run(&mut other, &format!("INSERT INTO {database}.t SELECT seq, 'c' FROM (SELECT 10 seq UNION SELECT 11 UNION SELECT 12) s")).await;
    run(&mut other, &format!("UPDATE {database}.t SET note = 'y' WHERE id = 2")).await;
    let blocked = {
        let (txs, pool, sql) = (txs.clone(), pool.clone(), format!("UPDATE {database}.t SET note = 'x' WHERE id = 2"));
        tokio::spawn(async move { txs.run("tx deadlock", &pool, &sql, false, None).await })
    };
    tokio::time::sleep(Duration::from_millis(500)).await;
    run(&mut other, &format!("UPDATE {database}.t SET note = 'y' WHERE id = 1")).await;
    run(&mut other, "ROLLBACK").await;
    let err = tokio::time::timeout(Duration::from_secs(10), blocked).await.unwrap().unwrap().unwrap_err();
    assert_eq!(err.code(), "command");
    assert!(err.user_message().contains("rolled the whole transaction back"), "{}", err.user_message());
    txs.finish("tx deadlock", false).await.unwrap();
    drop_database(&config, &database).await;
}

#[tokio::test]
async fn a_cancel_that_comes_as_a_run_ends_never_stops_the_next_run_on_its_session() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let pool = pool(&config).await;
    let txs = std::sync::Arc::new(MySqlTransactions::default());
    txs.begin(&pool, "tx late cancel", false).await.unwrap();
    for delay in 0..40u64 {
        let ending = {
            let (txs, pool) = (txs.clone(), pool.clone());
            tokio::spawn(async move { txs.run("tx late cancel", &pool, "DO SLEEP(0.02)", false, Some("mysql-run-late")).await })
        };
        tokio::time::sleep(Duration::from_micros(18_000 + delay * 100)).await;
        let cancel = {
            let pool = pool.clone();
            tokio::spawn(async move { cancel_mysql_run(&pool, "mysql-run-late").await })
        };
        let _ = ending.await.unwrap();
        let next = txs.run("tx late cancel", &pool, "SELECT SLEEP(0.05)", false, None).await;
        assert_eq!(next.map(|results| results[0].rows.clone()).map_err(|e| e.user_message()), Ok(vec![vec![json!(0)]]), "after {delay}");
        cancel.await.unwrap().unwrap();
    }
    txs.finish("tx late cancel", false).await.unwrap();
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
