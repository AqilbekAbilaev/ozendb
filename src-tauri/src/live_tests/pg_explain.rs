//! Live-PostgreSQL coverage of `explain_impl`. Shares `pg.rs`'s
//! helpers and skip behaviour; see its module doc comment for how to run these.

use crate::commands::{cancel_query_impl, explain_impl};
use super::pg::{pool, test_config};

#[tokio::test]
async fn explains_a_query_with_real_timings_and_undoes_anything_it_ran() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_explain CASCADE",
        "CREATE SCHEMA ozendb_it_explain",
        "CREATE TABLE ozendb_it_explain.t (id INT PRIMARY KEY, name TEXT)",
        "INSERT INTO ozendb_it_explain.t SELECT g, 'n' || g FROM generate_series(1, 100) g",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }

    let plan = explain_impl(&pool, "SELECT * FROM ozendb_it_explain.t WHERE id > 50;", false, None).await.unwrap();
    let top = &plan[0];
    assert!(top["Plan"]["Node Type"].is_string(), "{plan}");
    assert!(top["Plan"]["Actual Total Time"].is_number(), "ANALYZE timings are present: {plan}");
    assert!(top["Execution Time"].is_number());

    // ANALYZE executes the query; a write inside it is rolled back.
    let deleting = "WITH d AS (DELETE FROM ozendb_it_explain.t WHERE id = 1 RETURNING *) SELECT * FROM d";
    explain_impl(&pool, deleting, false, None).await.unwrap();
    let still: i64 = sqlx::query_scalar("SELECT count(*) FROM ozendb_it_explain.t WHERE id = 1").fetch_one(&pool).await.unwrap();
    assert_eq!(still, 1, "the explained DELETE was rolled back");

    // A read-only connection explains inside a read-only transaction.
    assert!(explain_impl(&pool, deleting, true, None).await.is_err());

    sqlx::query("DROP SCHEMA ozendb_it_explain CASCADE").execute(&pool).await.unwrap();
}

#[tokio::test]
async fn cancel_stops_an_explain_that_is_running() {
    let Some(config) = test_config() else { return eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests") };
    let pool = pool(&config).await;
    let running = {
        let pool = pool.clone();
        tokio::spawn(async move { explain_impl(&pool, "SELECT pg_sleep(30)", false, Some("pg-explain-sleep")).await })
    };
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    assert!(cancel_query_impl(&pool, "pg-explain-sleep").await.unwrap(), "a running Explain is found and cancelled");
    let stopped = tokio::time::timeout(std::time::Duration::from_secs(5), running).await.unwrap().unwrap().unwrap_err();
    assert_eq!(stopped.code(), "cancelled");
    assert!(!cancel_query_impl(&pool, "pg-explain-sleep").await.unwrap(), "a finished Explain cancels nothing");
}
