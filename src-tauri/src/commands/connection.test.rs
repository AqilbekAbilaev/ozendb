use super::*;

// A config with no credentials and no SSH — the baseline each test tweaks. Every
// field is spelled out because `ConnectionConfig` has no `Default`.
fn config() -> ConnectionConfig {
    ConnectionConfig {
        id: String::from("c1"),
        name: String::from("test"),
        hosts: vec![HostEntry { host: String::from("localhost"), port: 27017 }],
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
fn a_username_keeps_the_password() {
    let mut c = config();
    c.username = Some(String::from("admin"));
    assert_eq!(usable_secrets(&c).0, true);
}

#[test]
fn no_username_retires_the_password() {
    // Nothing to authenticate as, so the stored password can never be used again.
    assert_eq!(usable_secrets(&config()).0, false);

    let mut blank = config();
    blank.username = Some(String::new());
    assert_eq!(usable_secrets(&blank).0, false, "an empty username is no username");
}

#[test]
fn auth_mechanism_none_retires_the_password() {
    // "none" means the URI carries no credentials at all, username or not.
    let mut c = config();
    c.username = Some(String::from("admin"));
    c.auth_mechanism = Some(String::from("none"));
    assert_eq!(usable_secrets(&c).0, false);
}

#[test]
fn ssh_disabled_retires_both_ssh_secrets() {
    let mut c = config();
    c.ssh_auth = Some(String::from("password"));
    let (_, ssh_password, ssh_passphrase) = usable_secrets(&c);
    assert_eq!(ssh_password, false);
    assert_eq!(ssh_passphrase, false);
}

#[test]
fn each_ssh_auth_method_keeps_only_its_own_secret() {
    let mut password_auth = config();
    password_auth.ssh_enabled = true;
    password_auth.ssh_auth = Some(String::from("password"));
    assert_eq!(usable_secrets(&password_auth).1, true, "password auth keeps ssh-pass");
    assert_eq!(
        usable_secrets(&password_auth).2, false,
        "switching to password auth retires the key passphrase"
    );

    let mut key_auth = config();
    key_auth.ssh_enabled = true;
    key_auth.ssh_auth = Some(String::from("key"));
    assert_eq!(usable_secrets(&key_auth).2, true, "key auth keeps the passphrase");
    assert_eq!(
        usable_secrets(&key_auth).1, false,
        "switching to key auth retires the ssh password"
    );
}
