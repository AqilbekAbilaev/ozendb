//! Live-PostgreSQL coverage of stopping a running query: Cancel (`cancel_query_impl`)
//! and the statement timeout. Shares `pg.rs`'s helpers and skip
//! behaviour; see its module doc comment for how to run these.

use crate::commands::{cancel_query_impl, run_query_as};
use crate::error::AppError;
use super::pg::{pool, test_config};

// The message the frontend receives.
fn shown(err: &AppError) -> String {
    err.user_message()
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

#[tokio::test]
async fn cancel_stops_a_query_however_soon_it_comes() {
    let Some(config) = test_config() else { return eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests") };
    let pool = pool(&config).await;
    // Cancelled as soon as it can be found, often before its statement has started.
    for attempt in 0..20 {
        let id = format!("pg-query-soon {attempt}");
        let running = {
            let (pool, id) = (pool.clone(), id.clone());
            tokio::spawn(async move { run_query_as(&pool, "SELECT pg_sleep(3)", false, Some(&id)).await })
        };
        while !cancel_query_impl(&pool, &id).await.unwrap() {
            tokio::task::yield_now().await;
        }
        let stopped = tokio::time::timeout(std::time::Duration::from_secs(2), running).await.expect("Cancel stops it however soon it comes").unwrap().unwrap_err();
        assert_eq!(stopped.code(), "cancelled", "attempt {attempt}");
    }
}
