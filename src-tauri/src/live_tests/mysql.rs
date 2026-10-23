//! Live tests of the MySQL connect path: `mysql::uri::build_options` and
//! `ConnectionPool::connect_mysql`. Skipped unless `OZENDB_TEST_MYSQL` is set to a
//! `host:port`; `OZENDB_TEST_MYSQL_USER` (default "root") and `OZENDB_TEST_MYSQL_PASSWORD`
//! name the account. Run them with, e.g.:
//!   OZENDB_TEST_MYSQL=127.0.0.1:3307 OZENDB_TEST_MYSQL_PASSWORD=ozen cargo test live_tests::mysql
//! The tunnel test also needs the bastion `pg_ssh.rs` describes, with
//! `OZENDB_TEST_SSH_MYSQL_TARGET` naming MySQL as the bastion sees it.

use super::pg_ssh::{bastion, host_port, params};
use crate::known_hosts::KnownHostsStore;
use crate::mysql::uri::build_options;
use crate::pool::ConnectionPool;
use crate::ssh::{establish, HostKeyPrompts};
use crate::storage::{ConnectionConfig, EngineConfig, HostEntry, MySqlConfig};
use sqlx::mysql::MySqlConnection;
use sqlx::Connection;
use std::sync::Arc;
use tauri::Listener;

pub(super) const SKIP: &str = "skipping: set OZENDB_TEST_MYSQL=host:port to run the MySQL live tests";

/// The test server as a saved connection with no default database, or `None` to skip.
/// TLS is on, unverified, because MySQL 8's default `caching_sha2_password` login over a
/// plain connection needs sqlx's `mysql-rsa` feature, which is not enabled; the server's
/// own self-signed certificate is enough to carry the password instead.
pub(super) fn test_config() -> Option<ConnectionConfig> {
    let (host, port) = host_port(&std::env::var("OZENDB_TEST_MYSQL").ok()?);
    Some(ConnectionConfig {
        id: format!("mysql-it-{}", uuid::Uuid::new_v4()),
        name: String::from("MySQL live test"),
        hosts: vec![HostEntry { host, port }],
        username: Some(std::env::var("OZENDB_TEST_MYSQL_USER").unwrap_or_else(|_| String::from("root"))),
        engine: EngineConfig::MySql(MySqlConfig::default()),
        tls: true,
        tls_allow_invalid_certificates: true,
        ..Default::default()
    })
}

pub(super) fn password() -> Option<String> {
    std::env::var("OZENDB_TEST_MYSQL_PASSWORD").ok()
}

pub(super) async fn connect(config: &ConnectionConfig, database: &str) -> MySqlConnection {
    let options = build_options(config, password().as_deref(), database, None).unwrap();
    MySqlConnection::connect_with(&options).await.expect("the test server accepts the connection")
}

pub(super) async fn run(connection: &mut MySqlConnection, statement: &str) {
    sqlx::raw_sql(sqlx::AssertSqlSafe(statement.to_string())).execute(connection).await.unwrap();
}

async fn current_database(connection: &mut MySqlConnection) -> Option<String> {
    sqlx::query_scalar("SELECT DATABASE()").fetch_one(connection).await.unwrap()
}

#[tokio::test]
async fn a_connection_with_no_default_database_answers_a_query() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let mut connection = connect(&config, "").await;
    let answer: i64 = sqlx::query_scalar("SELECT 40 + 2").fetch_one(&mut connection).await.unwrap();
    assert_eq!(answer, 42);
    assert_eq!(current_database(&mut connection).await, None);
    connection.close().await.unwrap();
}

#[tokio::test]
async fn a_connection_opens_a_second_database_on_the_same_server() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let name = "ozendb it ведомость.2024";
    let mut admin = connect(&config, "").await;
    run(&mut admin, &format!("DROP DATABASE IF EXISTS `{name}`")).await;
    run(&mut admin, &format!("CREATE DATABASE `{name}`")).await;

    let mut other = connect(&config, name).await;
    assert_eq!(current_database(&mut other).await.as_deref(), Some(name));
    other.close().await.unwrap();

    run(&mut admin, &format!("DROP DATABASE `{name}`")).await;
    admin.close().await.unwrap();
}

#[tokio::test]
async fn a_wrong_password_is_reported_as_failed_authentication() {
    let Some(config) = test_config() else { return eprintln!("{SKIP}") };
    let options = build_options(&config, Some("not the password"), "", None).unwrap();
    let error = crate::error::AppError::MySql(MySqlConnection::connect_with(&options).await.err().unwrap());
    assert_eq!(error.code(), "auth");
    assert!(error.user_message().contains("Access denied"), "{}", error.user_message());
}

/// The pool reads its password from the keychain, so this logs in as a throwaway
/// passwordless user that a random connection id has nothing stored under.
#[tokio::test]
async fn the_pool_shares_one_pool_per_database_between_concurrent_callers() {
    let Some(mut config) = test_config() else { return eprintln!("{SKIP}") };
    let (user, other) = ("ozendb_it_pool", "ozendb_it_pool other");
    let mut admin = connect(&config, "").await;
    for statement in [
        format!("DROP USER IF EXISTS '{user}'@'%'"),
        format!("DROP DATABASE IF EXISTS `{other}`"),
        format!("CREATE DATABASE `{other}`"),
        format!("CREATE USER '{user}'@'%'"),
        format!("GRANT SELECT ON `{other}`.* TO '{user}'@'%'"),
    ] {
        run(&mut admin, &statement).await;
    }
    config.username = Some(String::from(user));
    let dir = tempfile::tempdir().unwrap();
    let pool = ConnectionPool::new(
        Arc::new(KnownHostsStore::new(dir.path().join("known_hosts.json"))),
        Arc::new(HostKeyPrompts::new()),
        tauri::test::mock_app().handle().clone(),
    );

    let callers = (0..4).map(|_| pool.connect_mysql(&config, None));
    let pools = futures_util::future::try_join_all(callers).await.unwrap();
    let in_other = pool.connect_mysql(&config, Some(other)).await.unwrap();
    let mut in_other_connection = in_other.acquire().await.unwrap();
    assert_eq!(current_database(&mut in_other_connection).await.as_deref(), Some(other));
    drop(in_other_connection);

    // Every caller got the cached pool, so closing one closes them all — and only them.
    pools[0].close().await;
    assert!(pools.iter().all(|handle| handle.is_closed()));
    assert!(!in_other.is_closed());
    pool.remove(&config.id).await;
    assert!(pool.get_mysql(&config.id, "").await.is_none());
    assert!(pool.get_mysql(&config.id, other).await.is_none());

    in_other.close().await;
    run(&mut admin, &format!("DROP USER '{user}'@'%'")).await;
    run(&mut admin, &format!("DROP DATABASE `{other}`")).await;
    admin.close().await.unwrap();
}

#[tokio::test]
async fn a_mysql_connection_runs_through_an_ssh_tunnel() {
    let (Some(config), Some(b)) = (test_config(), bastion("OZENDB_TEST_SSH_MYSQL_TARGET")) else {
        return eprintln!("skipping: set OZENDB_TEST_MYSQL and the OZENDB_TEST_SSH_* variables to run the tunnel test");
    };
    let dir = tempfile::tempdir().unwrap();
    let prompts = Arc::new(HostKeyPrompts::new());
    let app = tauri::test::mock_app();
    {
        let prompts = Arc::clone(&prompts);
        app.listen("ssh-host-key-prompt", move |event| {
            let payload: serde_json::Value = serde_json::from_str(event.payload()).unwrap();
            prompts.resolve(payload["requestId"].as_u64().unwrap(), true);
        });
    }
    let known = Arc::new(KnownHostsStore::new(dir.path().join("known_hosts.json")));
    let tunnel = establish(params(&b), known, prompts, app.handle().clone()).await.expect("the bastion opens a tunnel");

    let options = build_options(&config, password().as_deref(), "", Some(tunnel.local_addr.port())).unwrap();
    let mut connection = MySqlConnection::connect_with(&options).await.expect("MySQL reached through the tunnel");
    let answer: i64 = sqlx::query_scalar("SELECT 40 + 2").fetch_one(&mut connection).await.unwrap();
    assert_eq!(answer, 42);
    connection.close().await.unwrap();
}

#[tokio::test]
async fn a_missing_or_forbidden_database_gets_its_own_code() {
    let Some(mut config) = test_config() else { return eprintln!("{SKIP}") };
    let code = |config: ConnectionConfig, database: &'static str, password: Option<String>| async move {
        let options = build_options(&config, password.as_deref(), database, None).unwrap();
        crate::error::AppError::MySql(MySqlConnection::connect_with(&options).await.err().unwrap()).code()
    };
    assert_eq!(code(config.clone(), "ozendb_it_no_such_database", password()).await, "missing");

    let user = "ozendb_it_forbidden";
    let mut admin = connect(&config, "").await;
    run(&mut admin, &format!("DROP USER IF EXISTS '{user}'@'%'")).await;
    run(&mut admin, &format!("CREATE USER '{user}'@'%'")).await;
    config.username = Some(String::from(user));
    assert_eq!(code(config, "mysql", None).await, "forbidden");
    run(&mut admin, &format!("DROP USER '{user}'@'%'")).await;
    admin.close().await.unwrap();
}

/// Logs in through the pool, so as a throwaway passwordless user (see the pool test above),
/// once with a writable connection and once with a read-only one.
#[tokio::test]
async fn the_pool_caps_every_session_and_a_read_only_one_refuses_writes() {
    let Some(mut config) = test_config() else { return eprintln!("{SKIP}") };
    let (user, database) = ("ozendb_it_session", "ozendb it `session` ведомость");
    let quoted = format!("`{}`", database.replace('`', "``"));
    let mut admin = connect(&config, "").await;
    for statement in [
        format!("DROP USER IF EXISTS '{user}'@'%'"),
        format!("DROP DATABASE IF EXISTS {quoted}"),
        format!("CREATE DATABASE {quoted}"),
        format!("CREATE TABLE {quoted}.notes (body TEXT)"),
        format!("CREATE USER '{user}'@'%'"),
        format!("GRANT SELECT, INSERT ON {quoted}.* TO '{user}'@'%'"),
    ] {
        run(&mut admin, &statement).await;
    }
    config.username = Some(String::from(user));
    let read_only = ConnectionConfig { id: format!("{}-read-only", config.id), read_only: true, ..config.clone() };
    let dir = tempfile::tempdir().unwrap();
    let pool = ConnectionPool::new(
        Arc::new(KnownHostsStore::new(dir.path().join("known_hosts.json"))),
        Arc::new(HostKeyPrompts::new()),
        tauri::test::mock_app().handle().clone(),
    );
    let insert = "INSERT INTO notes (body) VALUES ('ünïcode')";
    let settings = "SELECT @@session.max_execution_time, @@session.transaction_read_only";

    let writable = pool.connect_mysql(&config, Some(database)).await.unwrap();
    let (limit, locked): (u64, i64) = sqlx::query_as(settings).fetch_one(&writable).await.unwrap();
    assert_eq!((limit, locked), (300_000, 0));
    sqlx::query(insert).execute(&writable).await.unwrap();

    let locked_pool = pool.connect_mysql(&read_only, Some(database)).await.unwrap();
    let (limit, locked): (u64, i64) = sqlx::query_as(settings).fetch_one(&locked_pool).await.unwrap();
    assert_eq!((limit, locked), (300_000, 1));
    let refusal = crate::error::AppError::MySql(sqlx::query(insert).execute(&locked_pool).await.unwrap_err());
    assert!(refusal.user_message().contains("READ ONLY"), "{}", refusal.user_message());

    pool.remove(&config.id).await;
    pool.remove(&read_only.id).await;
    writable.close().await;
    locked_pool.close().await;
    run(&mut admin, &format!("DROP USER '{user}'@'%'")).await;
    run(&mut admin, &format!("DROP DATABASE {quoted}")).await;
    admin.close().await.unwrap();
}
