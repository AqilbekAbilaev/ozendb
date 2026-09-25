//! Integration tests against a live PostgreSQL.
//!
//! These are skipped unless `OZENDB_TEST_POSTGRES` is set (to a `host` or
//! `host:port`). When set, they exercise the real connect-options + driver path
//! `pg_uri` (and, through it, `ConnectionPool::connect_postgres`) build — a plain
//! query round-trip — against a throwaway table that is dropped at the end. Default
//! `cargo test` stays green everywhere because each test returns early when the
//! variable is absent.
//!
//! Run them with, e.g.:
//!   OZENDB_TEST_POSTGRES=127.0.0.1:5432 cargo test pg_integration
//! `OZENDB_TEST_POSTGRES_USER`/`OZENDB_TEST_POSTGRES_PASSWORD` override the
//! username (default "postgres") and password (default none) if the test server
//! needs different credentials.

use crate::commands::{
    browse_table_impl, count_table_impl, list_columns_impl, list_databases_impl, list_schemas_impl,
    list_tables_impl, run_query_impl, update_row_impl, ColumnValue,
};
use crate::pg_uri;
use crate::storage::{ConnectionConfig, EngineConfig, HostEntry, PostgresConfig};
use sqlx::{Connection, Row};

/// A `ConnectionConfig` pointing at the test server, or `None` when the env var
/// is unset (so the caller skips). Username/password come from their own env vars
/// (mirroring how libpq/psql read `PGUSER`/`PGPASSWORD`) since a throwaway test
/// server still needs to authenticate as someone.
fn test_config() -> Option<ConnectionConfig> {
    let target = match std::env::var("OZENDB_TEST_POSTGRES") {
        Ok(val) => val,
        Err(_) => return None,
    };
    let (host, port) = match target.split_once(':') {
        Some((h, p)) => {
            let parsed = match p.parse::<u16>() {
                Ok(val) => val,
                Err(_) => 5432,
            };
            (h.to_string(), parsed)
        }
        None => (target, 5432),
    };
    Some(ConnectionConfig {
        id: String::from("pg-it-test"),
        name: String::from("integration-test"),
        hosts: vec![HostEntry { host: host, port: port }],
        // `build_options` rejects an empty username, so this always resolves to
        // something — "postgres" (the common default superuser) unless overridden.
        username: Some(
            std::env::var("OZENDB_TEST_POSTGRES_USER").unwrap_or_else(|_| String::from("postgres")),
        ),
        engine: EngineConfig::Postgres(PostgresConfig::default()),
        ..Default::default()
    })
}

fn options(config: &ConnectionConfig) -> sqlx::postgres::PgConnectOptions {
    let password = std::env::var("OZENDB_TEST_POSTGRES_PASSWORD").ok();
    match pg_uri::build_options(
        config,
        config.engine.as_postgres().expect("the integration config is Postgres"),
        password.as_deref(),
    ) {
        Ok(val) => val,
        Err(e) => panic!("could not build connect options: {}", e),
    }
}

/// Connect the way `ConnectionPool::connect_postgres` builds its options, then hand
/// them straight to the driver — bypassing `ConnectionPool` itself the same way
/// `integration_tests.rs`'s Mongo `connect()` does (a real `ConnectionPool` needs a
/// live Tauri `AppHandle`, which a plain test can't build).
async fn connect(config: &ConnectionConfig) -> sqlx::PgConnection {
    match sqlx::PgConnection::connect_with(&options(config)).await {
        Ok(val) => val,
        Err(e) => panic!("could not connect to test Postgres: {}", e),
    }
}

/// The pooled sibling of `connect`, for the postgres command `*_impl` functions,
/// which all take a `&PgPool` — same options, same bypass-`ConnectionPool` reason.
async fn pool(config: &ConnectionConfig) -> sqlx::PgPool {
    match sqlx::PgPool::connect_with(options(config)).await {
        Ok(val) => val,
        Err(e) => panic!("could not connect to test Postgres: {}", e),
    }
}

#[tokio::test]
async fn query_paging_and_count_round_trip() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let mut conn = connect(&config).await;

    match sqlx::query("DROP TABLE IF EXISTS ozendb_it_paging")
        .execute(&mut conn)
        .await
    {
        Ok(_) => {}
        Err(e) => panic!("drop table: {}", e),
    }
    match sqlx::query("CREATE TABLE ozendb_it_paging (n INT NOT NULL)")
        .execute(&mut conn)
        .await
    {
        Ok(_) => {}
        Err(e) => panic!("create table: {}", e),
    }

    for n in 0..25_i32 {
        match sqlx::query("INSERT INTO ozendb_it_paging (n) VALUES ($1)")
            .bind(n)
            .execute(&mut conn)
            .await
        {
            Ok(_) => {}
            Err(e) => panic!("insert: {}", e),
        }
    }

    // ORDER BY + OFFSET + LIMIT — the paging a table-browse command will do.
    let rows = match sqlx::query("SELECT n FROM ozendb_it_paging ORDER BY n OFFSET 10 LIMIT 5")
        .fetch_all(&mut conn)
        .await
    {
        Ok(val) => val,
        Err(e) => panic!("select: {}", e),
    };
    let got: Vec<i32> = rows.iter().map(|row| row.get("n")).collect();
    assert_eq!(got, vec![10, 11, 12, 13, 14]);

    // COUNT(*) with a filter — a row-count command's core.
    let count_row = match sqlx::query("SELECT COUNT(*) AS c FROM ozendb_it_paging WHERE n >= $1")
        .bind(20_i32)
        .fetch_one(&mut conn)
        .await
    {
        Ok(val) => val,
        Err(e) => panic!("count: {}", e),
    };
    let count: i64 = count_row.get("c");
    assert_eq!(count, 5);

    match sqlx::query("DROP TABLE ozendb_it_paging")
        .execute(&mut conn)
        .await
    {
        Ok(_) => {}
        Err(e) => panic!("drop table: {}", e),
    }
}

#[tokio::test]
async fn postgres_commands_round_trip() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let pool = pool(&config).await;

    for stmt in [
        "DROP SCHEMA IF EXISTS ozendb_it CASCADE",
        "CREATE SCHEMA ozendb_it",
        "CREATE TABLE ozendb_it.widgets (id SERIAL PRIMARY KEY, name TEXT NOT NULL, qty INT NOT NULL DEFAULT 0)",
        "INSERT INTO ozendb_it.widgets (name, qty) VALUES ('a', 1), ('b', 2), ('c', 3)",
    ] {
        match sqlx::query(stmt).execute(&pool).await {
            Ok(_) => {}
            Err(e) => panic!("setup ({stmt}): {e}"),
        }
    }

    // list_pg_databases — this connection's own database is on the server.
    let databases = list_databases_impl(&pool).await.unwrap();
    assert!(!databases.is_empty(), "expected at least one database");

    // list_pg_schemas — the fresh schema shows up, flagged non-system.
    let schemas = list_schemas_impl(&pool).await.unwrap();
    let ours = schemas.iter().find(|s| s.name == "ozendb_it").expect("schema listed");
    assert!(!ours.system);
    assert!(schemas.iter().any(|s| s.name == "pg_catalog" && s.system));

    // list_pg_tables
    let tables = list_tables_impl(&pool, "ozendb_it").await.unwrap();
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].name, "widgets");
    assert_eq!(tables[0].kind, "table");

    // list_pg_columns — id is the primary key, name/qty aren't.
    let columns = list_columns_impl(&pool, "ozendb_it", "widgets").await.unwrap();
    let by_name: std::collections::HashMap<&str, _> =
        columns.iter().map(|c| (c.name.as_str(), c)).collect();
    assert!(by_name["id"].is_primary_key);
    assert!(!by_name["name"].is_primary_key);
    assert_eq!(by_name["qty"].data_type, "integer");

    // run_pg_query — arbitrary read SQL comes back as JSON rows, in column order.
    let result = run_query_impl(&pool, "SELECT id, name, qty FROM ozendb_it.widgets ORDER BY id")
        .await
        .unwrap();
    assert_eq!(result.columns, vec!["id", "name", "qty"]);
    assert_eq!(result.rows.len(), 3);
    assert_eq!(result.rows[0]["name"], serde_json::json!("a"));
    assert!(!result.truncated);

    // browse_pg_table — paged, ordered by qty descending.
    let page = browse_table_impl(&pool, "ozendb_it", "widgets", Some("qty"), true, 2, 0)
        .await
        .unwrap();
    assert_eq!(page.rows.len(), 2);
    assert_eq!(page.rows[0]["name"], serde_json::json!("c"));

    // count_pg_table
    let total = count_table_impl(&pool, "ozendb_it", "widgets").await.unwrap();
    assert_eq!(total, 3);

    // update_pg_row — edit by primary key, then verify the change stuck.
    let affected = update_row_impl(
        &pool,
        "ozendb_it",
        "widgets",
        &[ColumnValue { column: String::from("qty"), value: serde_json::json!(99) }],
        &[ColumnValue { column: String::from("id"), value: serde_json::json!(1) }],
    )
    .await
    .unwrap();
    assert_eq!(affected, 1);
    let verify = run_query_impl(&pool, "SELECT qty FROM ozendb_it.widgets WHERE id = 1")
        .await
        .unwrap();
    assert_eq!(verify.rows[0]["qty"], serde_json::json!(99));

    // update_pg_row rejects a WHERE that omits a primary-key column, rather than
    // running an update that could silently match more than one row.
    let err = update_row_impl(
        &pool,
        "ozendb_it",
        "widgets",
        &[ColumnValue { column: String::from("qty"), value: serde_json::json!(1) }],
        &[ColumnValue { column: String::from("name"), value: serde_json::json!("a") }],
    )
    .await
    .unwrap_err();
    assert_eq!(err.code(), "validation");

    match sqlx::query("DROP SCHEMA ozendb_it CASCADE").execute(&pool).await {
        Ok(_) => {}
        Err(e) => panic!("drop schema: {}", e),
    }
}
