use super::*;
use crate::storage::{EngineConfig, HostEntry};

fn config() -> ConnectionConfig {
    ConnectionConfig {
        id: String::from("test"),
        name: String::from("Test"),
        hosts: vec![HostEntry { host: String::from("db.example.com"), port: 3307 }],
        username: Some(String::from("app user")),
        engine: EngineConfig::MySql(MySqlConfig::default()),
        ..Default::default()
    }
}

fn database(name: &str) -> MySqlConfig {
    MySqlConfig { database: Some(String::from(name)) }
}

#[test]
fn connection_string_names_everything_but_the_password() {
    assert_eq!(
        connection_string(&config(), &database("ведомость/2024")),
        "mysql://app%20user@db.example.com:3307/%D0%B2%D0%B5%D0%B4%D0%BE%D0%BC%D0%BE%D1%81%D1%82%D1%8C%2F2024?ssl-mode=DISABLED",
    );
}

#[test]
fn connection_string_leaves_out_a_default_database_it_was_not_given() {
    let mut config = config();
    config.username = None;
    config.hosts = vec![];
    assert_eq!(connection_string(&config, &MySqlConfig::default()), "mysql://localhost:3306/?ssl-mode=DISABLED");
}

#[test]
fn connection_string_spells_out_the_tls_mode_and_ca() {
    let mut config = config();
    config.tls = true;
    config.tls_allow_invalid_certificates = true;
    assert!(connection_string(&config, &database("app")).ends_with("/app?ssl-mode=REQUIRED"));
    config.tls_allow_invalid_certificates = false;
    config.tls_ca_file = Some(String::from("/etc/my ca.pem"));
    assert!(connection_string(&config, &database("app")).ends_with("?ssl-mode=VERIFY_IDENTITY&ssl-ca=%2Fetc%2Fmy%20ca.pem"));
}

#[test]
fn connection_string_leaves_out_the_ca_when_tls_is_off() {
    let mut config = config();
    config.tls_ca_file = Some(String::from("/etc/ca.pem"));
    assert!(connection_string(&config, &database("app")).ends_with("?ssl-mode=DISABLED"));
}

#[test]
fn connection_string_brackets_an_ipv6_host() {
    let mut config = config();
    config.hosts = vec![HostEntry { host: String::from("::1"), port: 3306 }];
    assert!(connection_string(&config, &database("app")).starts_with("mysql://app%20user@[::1]:3306/app"));
}

#[test]
fn build_options_dials_the_first_host_as_the_saved_user() {
    let options = build_options(&config(), Some("pa ss"), "ведомость/2024", None).unwrap();
    assert_eq!((options.get_host(), options.get_port()), ("db.example.com", 3307));
    assert_eq!(options.get_username(), "app user");
    assert_eq!(options.get_database(), Some("ведомость/2024"));
}

#[test]
fn build_options_dials_the_tunnel_instead_of_the_host_when_given_one() {
    let options = build_options(&config(), None, "app", Some(40123)).unwrap();
    assert_eq!((options.get_host(), options.get_port()), ("127.0.0.1", 40123));
}

#[test]
fn build_options_falls_back_to_localhost_without_hosts() {
    let mut config = config();
    config.hosts = vec![];
    let options = build_options(&config, None, "app", None).unwrap();
    assert_eq!((options.get_host(), options.get_port()), ("localhost", 3306));
}

#[test]
fn build_options_opens_no_default_database_for_an_empty_name() {
    assert_eq!(build_options(&config(), None, "", None).unwrap().get_database(), None);
}

#[test]
fn build_options_requires_a_username() {
    let mut config = config();
    config.username = Some(String::new());
    assert_eq!(build_options(&config, None, "app", None).unwrap_err().code(), "validation");
}

#[test]
fn build_options_matches_the_tls_mode_the_copied_uri_names() {
    let mut config = config();
    assert!(matches!(build_options(&config, None, "app", None).unwrap().get_ssl_mode(), MySqlSslMode::Disabled));
    config.tls = true;
    config.tls_allow_invalid_certificates = true;
    assert!(matches!(build_options(&config, None, "app", None).unwrap().get_ssl_mode(), MySqlSslMode::Required));
    config.tls_allow_invalid_certificates = false;
    assert!(matches!(build_options(&config, None, "app", None).unwrap().get_ssl_mode(), MySqlSslMode::VerifyIdentity));
}

#[test]
fn own_database_is_empty_when_the_config_names_none() {
    assert_eq!(own_database(&MySqlConfig::default()), "");
    assert_eq!(own_database(&database("shop floor")), "shop floor");
}
