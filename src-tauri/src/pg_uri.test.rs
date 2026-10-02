use super::*;
use crate::storage::{EngineConfig, HostEntry, PostgresConfig};
use sqlx::postgres::PgSslMode;

fn base_config() -> ConnectionConfig {
    ConnectionConfig {
        id: String::from("test"),
        name: String::from("Test"),
        hosts: vec![HostEntry { host: String::from("db.example.com"), port: 5433 }],
        username: Some(String::from("admin")),
        engine: EngineConfig::Postgres(PostgresConfig::default()),
        ..Default::default()
    }
}

/// The Postgres half of `base_config`, which every `build_options` call now needs
/// alongside the shared half.
fn base_postgres() -> PostgresConfig {
    PostgresConfig::default()
}

#[test]
fn build_options_uses_the_first_host() {
    let options = build_options(&base_config(), &base_postgres(), None).unwrap();
    assert_eq!(options.get_host(), "db.example.com");
    assert_eq!(options.get_port(), 5433);
}

#[test]
fn build_options_falls_back_to_localhost_when_no_hosts() {
    let mut config = base_config();
    config.hosts = vec![];
    let options = build_options(&config, &base_postgres(), None).unwrap();
    assert_eq!(options.get_host(), "localhost");
    assert_eq!(options.get_port(), 5432);
}

#[test]
fn build_options_defaults_the_database_to_postgres() {
    let options = build_options(&base_config(), &base_postgres(), None).unwrap();
    assert_eq!(options.get_database(), Some("postgres"));
}

#[test]
fn build_options_honors_an_explicit_database() {
    let postgres = PostgresConfig { database: Some(String::from("appdb")) };
    let options = build_options(&base_config(), &postgres, None).unwrap();
    assert_eq!(options.get_database(), Some("appdb"));
}

#[test]
fn build_options_carries_username_and_password() {
    let options = build_options(&base_config(), &base_postgres(), Some("s3cret")).unwrap();
    assert_eq!(options.get_username(), "admin");
    // Password has no getter (sqlx doesn't expose it back out); absence of a panic
    // building the options is the coverage available here.
}

#[test]
fn build_options_rejects_a_missing_username() {
    // Postgres always rejects an empty username; guessing one (OS user, or the
    // ambient PGUSER env var) would be exactly the leakage build_options refuses
    // for password, so this is a loud validation error instead.
    let mut config = base_config();
    config.username = None;
    let err = build_options(&config, &base_postgres(), None).unwrap_err();
    assert_eq!(err.code(), "validation");

    let mut blank = base_config();
    blank.username = Some(String::new());
    assert_eq!(build_options(&blank, &base_postgres(), None).unwrap_err().code(), "validation");
}

#[test]
fn build_options_disables_ssl_when_tls_is_off() {
    // Not sqlx's own `Prefer` default — an explicit `Disable`, so a stray ambient
    // `PGSSLMODE` env var can't upgrade a connection the editor says is plaintext.
    let options = build_options(&base_config(), &base_postgres(), None).unwrap();
    assert!(matches!(options.get_ssl_mode(), PgSslMode::Disable));
}

#[test]
fn build_options_verifies_full_when_tls_is_on_with_no_ca_file() {
    // `Require` alone doesn't verify the server certificate or hostname (see the
    // comment in options_for) — only VerifyCa/VerifyFull do, so plain `tls: true`
    // must resolve to VerifyFull, not the driver's weaker `Require`.
    let mut config = base_config();
    config.tls = true;
    let options = build_options(&config, &base_postgres(), None).unwrap();
    assert!(matches!(options.get_ssl_mode(), PgSslMode::VerifyFull));
}

#[test]
fn build_options_stays_verify_full_even_with_a_ca_file_configured() {
    // A custom CA must not silently drop the hostname check — sqlx adds the CA to
    // its imported root store rather than replacing it, so VerifyFull still works
    // with a custom CA; downgrading to VerifyCa just because one was given would
    // weaken verification for anyone whose CA's certs do carry a matching hostname.
    let mut config = base_config();
    config.tls = true;
    config.tls_ca_file = Some(String::from("/ca.pem"));
    let options = build_options(&config, &base_postgres(), None).unwrap();
    assert!(matches!(options.get_ssl_mode(), PgSslMode::VerifyFull));
}

#[test]
fn build_options_allows_invalid_certs_only_when_explicitly_opted_in() {
    let mut config = base_config();
    config.tls = true;
    config.tls_allow_invalid_certificates = true;
    let options = build_options(&config, &base_postgres(), None).unwrap();
    assert!(matches!(options.get_ssl_mode(), PgSslMode::Require));
}

#[test]
fn build_options_caps_every_statement_at_five_minutes() {
    // A runaway query is stopped by the server itself, whichever command ran it —
    // the table browse and count have no Cancel button of their own.
    let options = build_options(&base_config(), &base_postgres(), None).unwrap();
    assert_eq!(options.get_options(), Some("-c statement_timeout=300000"));
}

#[test]
fn build_options_leaves_the_session_writable_by_default() {
    let options = build_options(&base_config(), &base_postgres(), None).unwrap();
    assert!(!options.get_options().unwrap_or_default().contains("default_transaction_read_only"));
}

#[test]
fn build_options_enforces_read_only_at_the_session_level() {
    // Not just a Rust-side gate on which pool method got called — the server
    // itself refuses any write for the life of the session, so a caller that
    // reaches the driver a different way (e.g. `run_pg_query`'s wrapped
    // arbitrary SQL) still can't sneak one through.
    let mut config = base_config();
    config.read_only = true;
    let options = build_options(&config, &base_postgres(), None).unwrap();
    assert_eq!(options.get_options(), Some("-c statement_timeout=300000 -c default_transaction_read_only=on"));
}

#[test]
fn build_options_to_targets_the_given_host_and_port_instead_of_the_configs() {
    let options = build_options_to(&base_config(), &base_postgres(), None, "127.0.0.1", 15432).unwrap();
    assert_eq!(options.get_host(), "127.0.0.1");
    assert_eq!(options.get_port(), 15432);
}

#[test]
fn build_options_for_database_overrides_only_the_database() {
    let postgres = PostgresConfig { database: Some(String::from("appdb")) };
    let options = build_options_for_database(&base_config(), &postgres, None, "otherdb").unwrap();
    assert_eq!(options.get_database(), Some("otherdb"));
    assert_eq!(options.get_host(), "db.example.com");
    assert_eq!(options.get_port(), 5433);
}

#[test]
fn build_options_to_for_database_overrides_both_the_target_and_the_database() {
    let options = build_options_to_for_database(&base_config(), &base_postgres(), None, "127.0.0.1", 15432, "otherdb").unwrap();
    assert_eq!(options.get_database(), Some("otherdb"));
    assert_eq!(options.get_host(), "127.0.0.1");
    assert_eq!(options.get_port(), 15432);
}

#[test]
fn connection_string_names_everything_but_the_password() {
    let mut config = base_config();
    config.username = Some(String::from("app user"));
    config.tls = true;
    let postgres = PostgresConfig { database: Some(String::from("pay/ments")) };
    assert_eq!(connection_string(&config, &postgres), "postgresql://app%20user@db.example.com:5433/pay%2Fments?sslmode=verify-full");
}

#[test]
fn connection_string_spells_out_the_tls_mode_and_ca() {
    let mut config = base_config();
    assert_eq!(connection_string(&config, &base_postgres()), "postgresql://admin@db.example.com:5433/postgres?sslmode=disable");
    config.tls = true;
    config.tls_allow_invalid_certificates = true;
    assert!(connection_string(&config, &base_postgres()).ends_with("?sslmode=require"));
    config.tls_allow_invalid_certificates = false;
    config.tls_ca_file = Some(String::from("/etc/ca.pem"));
    assert!(connection_string(&config, &base_postgres()).ends_with("?sslmode=verify-full&sslrootcert=%2Fetc%2Fca.pem"));
    config.hosts = vec![HostEntry { host: String::from("::1"), port: 5432 }];
    assert!(connection_string(&config, &base_postgres()).starts_with("postgresql://admin@[::1]:5432/"));
}
