//! Live-PostgreSQL coverage of `insert_row_impl` (#137) — split into its
//! own file rather than grown into `pg_command_integration_tests.rs`, mirroring how
//! that file itself was split out of `pg_integration_tests.rs`. Shares that file's
//! `test_config`/`pool` helpers and skip behavior; see its module doc comment for
//! how to run these.

use crate::commands::{insert_row_impl, ColumnValue};
use crate::pg_integration_tests::{pool, test_config};
use serde_json::json;

fn col(column: &str, value: serde_json::Value) -> ColumnValue {
    ColumnValue { column: column.to_string(), value }
}

#[tokio::test]
async fn inserts_a_row_leaving_a_serial_primary_key_to_the_server() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_ins CASCADE",
        "CREATE SCHEMA ozendb_it_ins",
        "CREATE TABLE ozendb_it_ins.widgets (id SERIAL PRIMARY KEY, name TEXT NOT NULL)",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap();
    }

    let affected = insert_row_impl(&pool, "ozendb_it_ins", "widgets", &[col("name", json!("a"))])
        .await
        .unwrap();
    assert_eq!(affected, 1);

    let (id, name): (i32, String) = sqlx::query_as("SELECT id, name FROM ozendb_it_ins.widgets")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(id > 0, "the server should have filled in the serial id");
    assert_eq!(name, "a");
}

#[tokio::test]
async fn omitting_an_identity_column_lets_the_server_fill_it_in() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_ins_ident CASCADE",
        "CREATE SCHEMA ozendb_it_ins_ident",
        "CREATE TABLE ozendb_it_ins_ident.t ( \
            id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, \
            name TEXT NOT NULL \
        )",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap();
    }

    // A GENERATED ALWAYS identity column must never be targeted (428C9 if it is) —
    // this only supplies `name`.
    let affected = insert_row_impl(&pool, "ozendb_it_ins_ident", "t", &[col("name", json!("b"))])
        .await
        .unwrap();
    assert_eq!(affected, 1);

    let id: i32 = sqlx::query_scalar("SELECT id FROM ozendb_it_ins_ident.t").fetch_one(&pool).await.unwrap();
    assert!(id > 0);
}

#[tokio::test]
async fn targeting_a_stored_generated_column_is_refused_by_postgres() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it_ins_gen CASCADE",
        "CREATE SCHEMA ozendb_it_ins_gen",
        "CREATE TABLE ozendb_it_ins_gen.t ( \
            id SERIAL PRIMARY KEY, \
            n INT NOT NULL, \
            doubled INT GENERATED ALWAYS AS (n * 2) STORED \
        )",
    ] {
        sqlx::query(stmt).execute(&pool).await.unwrap();
    }

    let err = insert_row_impl(
        &pool,
        "ozendb_it_ins_gen",
        "t",
        &[col("n", json!(1)), col("doubled", json!(2))],
    )
    .await
    .unwrap_err();
    assert!(err.to_string().to_lowercase().contains("generated"), "{err}");
}

#[tokio::test]
async fn refuses_an_empty_insert() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;
    sqlx::query("CREATE TABLE IF NOT EXISTS public.ozendb_it_ins_empty (id INT)").execute(&pool).await.unwrap();

    let err = insert_row_impl(&pool, "public", "ozendb_it_ins_empty", &[]).await.unwrap_err();
    assert!(err.to_string().contains("Nothing to insert"), "{err}");

    sqlx::query("DROP TABLE public.ozendb_it_ins_empty").execute(&pool).await.ok();
}
