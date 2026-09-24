use super::*;
use crate::storage::HostEntry;
use sqlx::postgres::PgSslMode;

fn base_config() -> ConnectionConfig {
    ConnectionConfig {
        id: String::from("test"),
        name: String::from("Test"),
        engine: String::from("postgresql"),
        database: None,
        hosts: vec![HostEntry { host: String::from("db.example.com"), port: 5433 }],
        connection_type: String::from("standalone"),
        replica_set_name: None,
        username: Some(String::from("admin")),
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
    }
}

#[test]
fn build_options_uses_the_first_host() {
    let options = build_options(&base_config(), None).unwrap();
    assert_eq!(options.get_host(), "db.example.com");
    assert_eq!(options.get_port(), 5433);
}

#[test]
fn build_options_falls_back_to_localhost_when_no_hosts() {
    let mut config = base_config();
    config.hosts = vec![];
    let options = build_options(&config, None).unwrap();
    assert_eq!(options.get_host(), "localhost");
    assert_eq!(options.get_port(), 5432);
}

#[test]
fn build_options_defaults_the_database_to_postgres() {
    let options = build_options(&base_config(), None).unwrap();
    assert_eq!(options.get_database(), Some("postgres"));
}

#[test]
fn build_options_honors_an_explicit_database() {
    let mut config = base_config();
    config.database = Some(String::from("appdb"));
    let options = build_options(&config, None).unwrap();
    assert_eq!(options.get_database(), Some("appdb"));
}

#[test]
fn build_options_carries_username_and_password() {
    let options = build_options(&base_config(), Some("s3cret")).unwrap();
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
    let err = build_options(&config, None).unwrap_err();
    assert_eq!(err.code(), "validation");

    let mut blank = base_config();
    blank.username = Some(String::new());
    assert_eq!(build_options(&blank, None).unwrap_err().code(), "validation");
}

#[test]
fn build_options_disables_ssl_when_tls_is_off() {
    // Not sqlx's own `Prefer` default — an explicit `Disable`, so a stray ambient
    // `PGSSLMODE` env var can't upgrade a connection the editor says is plaintext.
    let options = build_options(&base_config(), None).unwrap();
    assert!(matches!(options.get_ssl_mode(), PgSslMode::Disable));
}

#[test]
fn build_options_verifies_full_when_tls_is_on_with_no_ca_file() {
    // `Require` alone doesn't verify the server certificate or hostname (see the
    // comment in options_for) — only VerifyCa/VerifyFull do, so plain `tls: true`
    // must resolve to VerifyFull, not the driver's weaker `Require`.
    let mut config = base_config();
    config.tls = true;
    let options = build_options(&config, None).unwrap();
    assert!(matches!(options.get_ssl_mode(), PgSslMode::VerifyFull));
}

#[test]
fn build_options_verifies_ca_only_when_a_ca_file_is_given() {
    let mut config = base_config();
    config.tls = true;
    config.tls_ca_file = Some(String::from("/ca.pem"));
    let options = build_options(&config, None).unwrap();
    assert!(matches!(options.get_ssl_mode(), PgSslMode::VerifyCa));
}

#[test]
fn build_options_allows_invalid_certs_only_when_explicitly_opted_in() {
    let mut config = base_config();
    config.tls = true;
    config.tls_allow_invalid_certificates = true;
    let options = build_options(&config, None).unwrap();
    assert!(matches!(options.get_ssl_mode(), PgSslMode::Require));
}

#[test]
fn build_options_to_targets_the_given_host_and_port_instead_of_the_configs() {
    let options = build_options_to(&base_config(), None, "127.0.0.1", 15432).unwrap();
    assert_eq!(options.get_host(), "127.0.0.1");
    assert_eq!(options.get_port(), 15432);
}
