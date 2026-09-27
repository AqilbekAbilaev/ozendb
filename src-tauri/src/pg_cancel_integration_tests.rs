//! Live-PostgreSQL coverage of stopping a running query: Cancel (`cancel_query_impl`)
//! and the statement timeout. Shares `pg_integration_tests.rs`'s helpers and skip
//! behaviour; see its module doc comment for how to run these.

use crate::commands::{cancel_query_impl, run_query_as};
use crate::error::AppError;
use crate::pg_integration_tests::{pool, test_config};

// The message the frontend receives — the serialized `{ code, message }`.
fn shown(err: &AppError) -> String {
    serde_json::to_value(err).unwrap()["message"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn cancel_stops_a_running_query_by_its_run_id() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let running = {
        let pool = pool.clone();
        tokio::spawn(async move { run_query_as(&pool, "SELECT pg_sleep(10)", false, Some("run-1")).await })
    };
    // Give the query time to reach the server and register its backend.
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    assert!(cancel_query_impl(&pool, "run-1").await.unwrap(), "a running query is found and cancelled");
    let err = running.await.unwrap().unwrap_err();
    assert_eq!(err.code(), "cancelled");
    assert_eq!(shown(&err), "The query was cancelled.");

    // Once finished it's no longer running, and an unknown id cancels nothing.
    assert!(!cancel_query_impl(&pool, "run-1").await.unwrap());
    assert!(!cancel_query_impl(&pool, "never-ran").await.unwrap());
}

#[tokio::test]
async fn a_statement_over_the_timeout_is_reported_as_timed_out() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("SET LOCAL statement_timeout = 50").execute(&mut *tx).await.unwrap();
    let err = AppError::Postgres(sqlx::query("SELECT pg_sleep(1)").execute(&mut *tx).await.unwrap_err());
    assert_eq!(err.code(), "cancelled");
    assert_eq!(shown(&err), "The query ran past its time limit and was stopped.");
}
