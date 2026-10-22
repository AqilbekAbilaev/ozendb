use super::*;
use crate::storage::HostEntry;

const FORMAT: SqlUriFormat = SqlUriFormat {
    scheme: "sq-l",
    default_port: 4321,
    mode_param: "tls.mode",
    modes: ["Off", "Encrypt_Only", "Verify"],
    ca_param: "tls.ca",
};

fn config() -> ConnectionConfig {
    ConnectionConfig {
        hosts: vec![HostEntry { host: String::from("db.example.com"), port: 4322 }],
        username: Some(String::from("app user")),
        ..Default::default()
    }
}

#[test]
fn names_the_user_host_port_and_database() {
    assert_eq!(connection_string(&config(), "pay/ments ü", &FORMAT), "sq-l://app%20user@db.example.com:4322/pay%2Fments%20%C3%BC?tls.mode=Off");
}

#[test]
fn falls_back_to_localhost_on_the_default_port_without_a_user() {
    let mut config = config();
    config.hosts = vec![];
    config.username = Some(String::new());
    assert_eq!(connection_string(&config, "", &FORMAT), "sq-l://localhost:4321/?tls.mode=Off");
}

#[test]
fn picks_the_tls_mode_from_the_two_switches() {
    let mut config = config();
    config.tls = true;
    config.tls_allow_invalid_certificates = true;
    assert!(connection_string(&config, "app", &FORMAT).ends_with("?tls.mode=Encrypt_Only"));
    config.tls_allow_invalid_certificates = false;
    assert!(connection_string(&config, "app", &FORMAT).ends_with("?tls.mode=Verify"));
}

#[test]
fn names_the_ca_file_only_while_tls_is_on() {
    let mut config = config();
    config.tls_ca_file = Some(String::from("/etc/my ca.pem"));
    assert!(connection_string(&config, "app", &FORMAT).ends_with("?tls.mode=Off"));
    config.tls = true;
    assert!(connection_string(&config, "app", &FORMAT).ends_with("?tls.mode=Verify&tls.ca=%2Fetc%2Fmy%20ca.pem"));
}

#[test]
fn brackets_an_ipv6_host() {
    let mut config = config();
    config.hosts = vec![HostEntry { host: String::from("::1"), port: 4322 }];
    assert!(connection_string(&config, "app", &FORMAT).starts_with("sq-l://app%20user@[::1]:4322/app"));
}
