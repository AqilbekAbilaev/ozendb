//! Integration tests against a live PostgreSQL for the connect path itself
//! (`postgres::uri`/`ConnectionPool::connect_postgres`) — the `commands::postgres::*`
//! command layer (schema browsing, query, row edit) has its own tests in
//! `pg_command.rs`, which shares this file's `test_config`/
//! `pool` helpers.
//!
//! These are skipped unless `OZENDB_TEST_POSTGRES` is set (to a `host` or
//! `host:port`). When set, they exercise the real connect-options + driver path
//! `postgres::uri` (and, through it, `ConnectionPool::connect_postgres`) build — a plain
//! query round-trip — against a throwaway table that is dropped at the end. Default
//! `cargo test` stays green everywhere because each test returns early when the
//! variable is absent.
//!
//! Run them with, e.g.:
//!   OZENDB_TEST_POSTGRES=127.0.0.1:5432 cargo test live_tests::pg
//! `OZENDB_TEST_POSTGRES_USER`/`OZENDB_TEST_POSTGRES_PASSWORD` override the
//! username (default "postgres") and password (default none) if the test server
//! needs different credentials.

use crate::postgres::uri as pg_uri;
use crate::storage::{ConnectionConfig, EngineConfig, HostEntry, PostgresConfig};
use sqlx::{Connection, Row};

/// A `ConnectionConfig` pointing at the test server, or `None` when the env var
/// is unset (so the caller skips). Username/password come from their own env vars
/// (mirroring how libpq/psql read `PGUSER`/`PGPASSWORD`) since a throwaway test
/// server still needs to authenticate as someone. `pub(crate)`: shared with
/// `pg_command.rs`, split out once this file grew past the
/// size limit — both cover the same live server, just different command layers.
pub(crate) fn test_config() -> Option<ConnectionConfig> {
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
/// `mongodb.rs`'s Mongo `connect()` does (a real `ConnectionPool` needs a
/// live Tauri `AppHandle`, which a plain test can't build).
async fn connect(config: &ConnectionConfig) -> sqlx::PgConnection {
    match sqlx::PgConnection::connect_with(&options(config)).await {
        Ok(val) => val,
        Err(e) => panic!("could not connect to test Postgres: {}", e),
    }
}

/// The pooled sibling of `connect`, for the postgres command `*_impl` functions,
/// which all take a `&PgPool` — same options, same bypass-`ConnectionPool`
/// reason. `pub(crate)`: see `test_config`'s doc comment.
pub(crate) async fn pool(config: &ConnectionConfig) -> sqlx::PgPool {
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

/// `ConnectionPool::connect_postgres`'s `database` override (#124): the same
/// connection's options, targeting a database other than the config's own, reusing
/// everything else (host, credentials, TLS). Proven here at the `postgres::uri` layer that
/// actually builds those options, since a live `ConnectionPool` needs an `AppHandle`
/// a plain test can't build (see this file's own doc comment).
#[tokio::test]
async fn opens_and_queries_a_second_database_on_the_same_server() {
    let config = match test_config() {
        Some(val) => val,
        None => {
            eprintln!("skipping: set OZENDB_TEST_POSTGRES=host[:port] to run live tests");
            return;
        }
    };
    let mut conn = connect(&config).await;

    // CREATE/DROP DATABASE can't run inside a transaction, and DROP DATABASE
    // refuses while anyone is connected to it — both run here on the config's own
    // (default) database, never on the throwaway one itself.
    let _ = sqlx::query("DROP DATABASE IF EXISTS ozendb_it_other_db").execute(&mut conn).await;
    match sqlx::query("CREATE DATABASE ozendb_it_other_db").execute(&mut conn).await {
        Ok(_) => {}
        Err(e) => panic!("create database: {}", e),
    }

    let password = std::env::var("OZENDB_TEST_POSTGRES_PASSWORD").ok();
    let postgres = config.engine.as_postgres().expect("the integration config is Postgres");
    let other_options = match pg_uri::build_options_for_database(&config, postgres, password.as_deref(), "ozendb_it_other_db") {
        Ok(val) => val,
        Err(e) => panic!("could not build connect options for the other database: {}", e),
    };
    let mut other_conn = match sqlx::PgConnection::connect_with(&other_options).await {
        Ok(val) => val,
        Err(e) => panic!("could not connect to the second database: {}", e),
    };

    let current_db: String = match sqlx::query_scalar("SELECT current_database()").fetch_one(&mut other_conn).await {
        Ok(val) => val,
        Err(e) => panic!("select current_database: {}", e),
    };
    assert_eq!(current_db, "ozendb_it_other_db");

    if let Err(e) = other_conn.close().await {
        panic!("could not close the second database connection: {}", e);
    }
    match sqlx::query("DROP DATABASE ozendb_it_other_db").execute(&mut conn).await {
        Ok(_) => {}
        Err(e) => panic!("drop database: {}", e),
    }
}
