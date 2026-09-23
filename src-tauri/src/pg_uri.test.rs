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
        username: None,
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
    let options = build_options(&base_config(), None);
    assert_eq!(options.get_host(), "db.example.com");
    assert_eq!(options.get_port(), 5433);
}

#[test]
fn build_options_falls_back_to_localhost_when_no_hosts() {
    let mut config = base_config();
    config.hosts = vec![];
    let options = build_options(&config, None);
    assert_eq!(options.get_host(), "localhost");
    assert_eq!(options.get_port(), 5432);
}

#[test]
fn build_options_defaults_the_database_to_postgres() {
    let options = build_options(&base_config(), None);
    assert_eq!(options.get_database(), Some("postgres"));
}

#[test]
fn build_options_honors_an_explicit_database() {
    let mut config = base_config();
    config.database = Some(String::from("appdb"));
    let options = build_options(&config, None);
    assert_eq!(options.get_database(), Some("appdb"));
}

#[test]
fn build_options_carries_username_and_password() {
    let mut config = base_config();
    config.username = Some(String::from("admin"));
    let options = build_options(&config, Some("s3cret"));
    assert_eq!(options.get_username(), "admin");
    // Password has no getter (sqlx doesn't expose it back out); absence of a panic
    // building the options is the coverage available here.
}

#[test]
fn build_options_defaults_ssl_mode_to_prefer_when_tls_is_off() {
    // PgSslMode has no PartialEq, so match on the variant directly.
    let options = build_options(&base_config(), None);
    assert!(matches!(options.get_ssl_mode(), PgSslMode::Prefer));
}

#[test]
fn build_options_requires_tls_when_configured() {
    let mut config = base_config();
    config.tls = true;
    let options = build_options(&config, None);
    assert!(matches!(options.get_ssl_mode(), PgSslMode::Require));
}

#[test]
fn build_options_to_targets_the_given_host_and_port_instead_of_the_configs() {
    let options = build_options_to(&base_config(), None, "127.0.0.1", 15432);
    assert_eq!(options.get_host(), "127.0.0.1");
    assert_eq!(options.get_port(), 15432);
}
