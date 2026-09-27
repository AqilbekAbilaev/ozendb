//! Live-PostgreSQL coverage of `explain_impl`. Shares `pg_integration_tests.rs`'s
//! helpers and skip behaviour; see its module doc comment for how to run these.

use crate::commands::explain_impl;
use crate::pg_integration_tests::{pool, test_config};

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

    let plan = explain_impl(&pool, "SELECT * FROM ozendb_it_explain.t WHERE id > 50;", false).await.unwrap();
    let top = &plan[0];
    assert!(top["Plan"]["Node Type"].is_string(), "{plan}");
    assert!(top["Plan"]["Actual Total Time"].is_number(), "ANALYZE timings are present: {plan}");
    assert!(top["Execution Time"].is_number());

    // ANALYZE executes the query; a write inside it is rolled back.
    let deleting = "WITH d AS (DELETE FROM ozendb_it_explain.t WHERE id = 1 RETURNING *) SELECT * FROM d";
    explain_impl(&pool, deleting, false).await.unwrap();
    let still: i64 = sqlx::query_scalar("SELECT count(*) FROM ozendb_it_explain.t WHERE id = 1").fetch_one(&pool).await.unwrap();
    assert_eq!(still, 1, "the explained DELETE was rolled back");

    // A read-only connection explains inside a read-only transaction.
    assert!(explain_impl(&pool, deleting, true).await.is_err());

    sqlx::query("DROP SCHEMA ozendb_it_explain CASCADE").execute(&pool).await.unwrap();
}
