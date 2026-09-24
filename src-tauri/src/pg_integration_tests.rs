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

use crate::pg_uri;
use crate::storage::{ConnectionConfig, HostEntry};
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
        engine: String::from("postgresql"),
        database: None,
        hosts: vec![HostEntry { host: host, port: port }],
        connection_type: String::from("standalone"),
        replica_set_name: None,
        // `build_options` now rejects an empty username, so this always resolves to
        // something — "postgres" (the common default superuser) unless overridden.
        username: Some(std::env::var("OZENDB_TEST_POSTGRES_USER").unwrap_or_else(|_| String::from("postgres"))),
        auth_db: None,
        auth_mechanism: None,
        options: std::collections::BTreeMap::new(),
        tls: false,
        tls_ca_file: None,
        tls_cert_key_file: None,
        tls_allow_invalid_certificates: false,
        ssh_enabled: false,
        ssh_host: None,
        ssh_port: 22,
        ssh_user: None,
        ssh_auth: None,
        ssh_key_file: None,
        tag: None,
        read_only: false,
        folder_id: None,
        last_accessed: None,
        open: false,
    })
}

/// Connect the way `ConnectionPool::connect_postgres` builds its options, then hand
/// them straight to the driver — bypassing `ConnectionPool` itself the same way
/// `integration_tests.rs`'s Mongo `connect()` does (a real `ConnectionPool` needs a
/// live Tauri `AppHandle`, which a plain test can't build).
async fn connect(config: &ConnectionConfig) -> sqlx::PgConnection {
    let password = std::env::var("OZENDB_TEST_POSTGRES_PASSWORD").ok();
    let options = match pg_uri::build_options(config, password.as_deref()) {
        Ok(val) => val,
        Err(e) => panic!("could not build connect options: {}", e),
    };
    match sqlx::PgConnection::connect_with(&options).await {
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
