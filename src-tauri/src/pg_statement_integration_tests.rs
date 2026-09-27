//! Live-PostgreSQL coverage of the SQL tab running statements, not only queries.
//! Shares `pg_integration_tests.rs`'s helpers and skip behaviour; see its module doc
//! comment for how to run these.

use crate::commands::run_query_as;
use crate::pg_integration_tests::{pool, test_config};

#[tokio::test]
async fn statements_run_and_report_the_rows_they_changed() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let run = |sql: &'static str| {
        let pool = pool.clone();
        async move { run_query_as(&pool, sql, false, None).await.unwrap() }
    };

    run("DROP SCHEMA IF EXISTS ozendb_it_stmt CASCADE").await;
    let created = run("CREATE SCHEMA ozendb_it_stmt").await;
    assert!(created.columns.is_empty());
    run("CREATE TABLE ozendb_it_stmt.t (id int PRIMARY KEY, n int)").await;

    assert_eq!(run("INSERT INTO ozendb_it_stmt.t VALUES (1, 1), (2, 2), (3, 3)").await.rows_affected, Some(3));
    assert_eq!(run("UPDATE ozendb_it_stmt.t SET n = n * 10 WHERE id > 1").await.rows_affected, Some(2));
    assert_eq!(run("DELETE FROM ozendb_it_stmt.t WHERE id = 1").await.rows_affected, Some(1));

    let rows = run("SELECT n FROM ozendb_it_stmt.t ORDER BY id").await;
    assert_eq!(rows.rows, vec![vec![serde_json::json!(20)], vec![serde_json::json!(30)]]);
    assert_eq!(rows.rows_affected, None);

    run("DROP SCHEMA ozendb_it_stmt CASCADE").await;
}

#[tokio::test]
async fn a_read_only_connection_still_refuses_statements() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let err = run_query_as(&pool, "CREATE TABLE ozendb_it_never (id int)", true, None).await.unwrap_err();
    assert!(err.to_string().contains("read-only"), "{err}");
}
