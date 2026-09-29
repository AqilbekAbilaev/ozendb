//! Live-PostgreSQL coverage of the stats reads (`table_stats_impl`, and the
//! per-database size `list_databases_impl` reports). Shares
//! `pg_integration_tests.rs`'s helpers and skip behaviour; see its module doc
//! comment for how to run these.

use crate::commands::{list_databases_impl, table_stats_impl};
use crate::pg_integration_tests::{pool, test_config};

const SCHEMA: &str = "ozendb_it_stats";

#[tokio::test]
async fn table_stats_report_sizes_indexes_and_vacuum_state() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        format!("DROP SCHEMA IF EXISTS {SCHEMA} CASCADE"),
        format!("CREATE SCHEMA {SCHEMA}"),
        format!("CREATE TABLE {SCHEMA}.t (id INT PRIMARY KEY, name TEXT)"),
        format!("CREATE INDEX t_name_idx ON {SCHEMA}.t (name)"),
        format!("INSERT INTO {SCHEMA}.t SELECT i, 'name ' || i FROM generate_series(1, 500) AS i"),
        // ANALYZE fills reltuples; without it the estimate stays -1 (never analysed).
        format!("ANALYZE {SCHEMA}.t"),
    ] {
        sqlx::query(sqlx::AssertSqlSafe(stmt.clone())).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }

    let stats = table_stats_impl(&pool, SCHEMA, "t").await.expect("table stats");

    // The heap alone is smaller than the heap plus its two indexes.
    assert!(stats.table_size_bytes > 0, "heap size: {}", stats.table_size_bytes);
    assert!(stats.indexes_size_bytes > 0, "index size: {}", stats.indexes_size_bytes);
    assert!(
        stats.total_size_bytes >= stats.table_size_bytes + stats.indexes_size_bytes,
        "total {} < heap {} + indexes {}",
        stats.total_size_bytes,
        stats.table_size_bytes,
        stats.indexes_size_bytes,
    );
    assert_eq!(stats.estimated_rows, Some(500));
    assert_eq!(stats.dead_rows, 0);
    // ANALYZE ran above, so the table reports when — vacuum has not, so it doesn't.
    assert!(stats.last_analyze.is_some(), "last analyze missing");

    // The primary key's index and the one created by name, each with a scan count.
    let mut names: Vec<&str> = stats.indexes.iter().map(|i| i.name.as_str()).collect();
    names.sort_unstable();
    assert_eq!(names, vec!["t_name_idx", "t_pkey"]);
    assert!(stats.indexes.iter().all(|i| i.size_bytes > 0), "an index reported no size");

    sqlx::query(sqlx::AssertSqlSafe(format!("DROP SCHEMA {SCHEMA} CASCADE"))).execute(&pool).await.ok();
}

#[tokio::test]
async fn dead_rows_appear_after_an_update_and_clear_after_a_vacuum() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let schema = format!("{SCHEMA}_dead");
    for stmt in [
        format!("DROP SCHEMA IF EXISTS {schema} CASCADE"),
        format!("CREATE SCHEMA {schema}"),
        format!("CREATE TABLE {schema}.t (id INT PRIMARY KEY, n INT)"),
        format!("INSERT INTO {schema}.t SELECT i, i FROM generate_series(1, 200) AS i"),
        // Every updated row leaves its old version behind as a dead tuple.
        format!("UPDATE {schema}.t SET n = n + 1"),
        format!("ANALYZE {schema}.t"),
    ] {
        sqlx::query(sqlx::AssertSqlSafe(stmt.clone())).execute(&pool).await.unwrap_or_else(|e| panic!("setup ({stmt}): {e}"));
    }

    let before = table_stats_impl(&pool, &schema, "t").await.expect("stats before vacuum");
    assert!(before.dead_rows > 0, "no dead rows after updating every row");

    sqlx::query(sqlx::AssertSqlSafe(format!("VACUUM {schema}.t"))).execute(&pool).await.expect("vacuum");
    let after = table_stats_impl(&pool, &schema, "t").await.expect("stats after vacuum");
    assert_eq!(after.dead_rows, 0);
    assert!(after.last_vacuum.is_some(), "last vacuum missing after VACUUM");

    sqlx::query(sqlx::AssertSqlSafe(format!("DROP SCHEMA {schema} CASCADE"))).execute(&pool).await.ok();
}

#[tokio::test]
async fn an_unknown_table_is_an_error_not_an_empty_reading() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let missing = table_stats_impl(&pool, "public", "ozendb_no_such_table").await;
    assert!(missing.is_err(), "a missing table reported stats");
}

#[tokio::test]
async fn databases_report_their_size() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    let databases = list_databases_impl(&pool).await.expect("databases");
    assert!(!databases.is_empty(), "no databases listed");
    // A database this role may connect to reports its size; one it may not reports
    // None rather than failing the whole listing.
    assert!(
        databases.iter().any(|d| d.size_bytes.unwrap_or(0) > 0),
        "no listed database reported a size",
    );
}
