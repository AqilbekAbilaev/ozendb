//! Live-PostgreSQL coverage of `delete_rows_impl` (#138) — split into
//! its own file rather than grown into `pg_command_integration_tests.rs`,
//! mirroring how that file itself was split out of `pg_integration_tests.rs`.
//! Shares that file's `test_config`/`pool` helpers and skip behavior; see its
//! module doc comment for how to run these.

use crate::commands::{delete_rows_impl, ColumnValue};
use crate::pg_integration_tests::{pool, test_config};
use serde_json::json;

fn col(column: &str, value: serde_json::Value) -> ColumnValue {
    ColumnValue { column: column.to_string(), value }
}

#[tokio::test]
async fn deletes_a_batch_by_single_column_primary_key() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_del CASCADE",
        "CREATE SCHEMA ozendb_it_del",
        "CREATE TABLE ozendb_it_del.widgets (id SERIAL PRIMARY KEY, name TEXT NOT NULL)",
        "INSERT INTO ozendb_it_del.widgets (name) VALUES ('a'), ('b'), ('c')",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap();
    }

    let affected = delete_rows_impl(
        &pool,
        "ozendb_it_del",
        "widgets",
        &[vec![col("id", json!(1))], vec![col("id", json!(2))]],
    )
    .await
    .unwrap();
    assert_eq!(affected, 2);

    let remaining: Vec<String> = sqlx::query_scalar("SELECT name FROM ozendb_it_del.widgets ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, vec!["c".to_string()]);
}

#[tokio::test]
async fn deletes_by_a_composite_primary_key() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_del_ck CASCADE",
        "CREATE SCHEMA ozendb_it_del_ck",
        "CREATE TABLE ozendb_it_del_ck.pairs (a INT, b INT, PRIMARY KEY (a, b))",
        "INSERT INTO ozendb_it_del_ck.pairs VALUES (1, 1), (1, 2), (2, 1)",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap();
    }

    // (1, 2) must not match (2, 1) — the batch keys by the whole tuple, not either
    // column alone.
    let affected = delete_rows_impl(
        &pool,
        "ozendb_it_del_ck",
        "pairs",
        &[vec![col("a", json!(1)), col("b", json!(2))]],
    )
    .await
    .unwrap();
    assert_eq!(affected, 1);

    let remaining: i64 = sqlx::query_scalar("SELECT count(*) FROM ozendb_it_del_ck.pairs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, 2);
}

#[tokio::test]
async fn reports_fewer_rows_deleted_when_one_was_already_gone() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_del_conflict CASCADE",
        "CREATE SCHEMA ozendb_it_del_conflict",
        "CREATE TABLE ozendb_it_del_conflict.t (id SERIAL PRIMARY KEY)",
        "INSERT INTO ozendb_it_del_conflict.t (id) VALUES (1)",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap();
    }

    // id 2 never existed — a conflict (already gone), not an error, and not silently
    // ignored: the caller sees 1 affected, not 2.
    let affected = delete_rows_impl(
        &pool,
        "ozendb_it_del_conflict",
        "t",
        &[vec![col("id", json!(1))], vec![col("id", json!(2))]],
    )
    .await
    .unwrap();
    assert_eq!(affected, 1);
}

#[tokio::test]
async fn refuses_a_row_missing_a_primary_key_column() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_del_badkey CASCADE",
        "CREATE SCHEMA ozendb_it_del_badkey",
        "CREATE TABLE ozendb_it_del_badkey.t (id SERIAL PRIMARY KEY, name TEXT)",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap();
    }

    let err = delete_rows_impl(&pool, "ozendb_it_del_badkey", "t", &[vec![col("name", json!("a"))]])
        .await
        .unwrap_err();
    assert!(err.to_string().contains("primary-key"), "{err}");
}

#[tokio::test]
async fn refuses_a_table_with_no_primary_key() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_del_nokey CASCADE",
        "CREATE SCHEMA ozendb_it_del_nokey",
        "CREATE TABLE ozendb_it_del_nokey.t (id INT)",
        "INSERT INTO ozendb_it_del_nokey.t VALUES (1)",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap();
    }

    let err = delete_rows_impl(&pool, "ozendb_it_del_nokey", "t", &[vec![col("id", json!(1))]])
        .await
        .unwrap_err();
    assert!(err.to_string().contains("no primary key"), "{err}");
}
