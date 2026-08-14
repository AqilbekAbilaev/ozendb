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

// A form with every field set to something distinguishable, so a field mapped to the
// wrong place in `into_config` shows up as a mismatch rather than two matching blanks.
fn fields() -> ConnectionFields {
    ConnectionFields {
        name: String::from("prod"),
        hosts: vec![HostEntry { host: String::from("db1"), port: 27018 }],
        connection_type: String::from("replica"),
        replica_set_name: Some(String::from("rs0")),
        username: Some(String::from("admin")),
        auth_db: Some(String::from("authdb")),
        auth_mechanism: Some(String::from("X509")),
        options: std::collections::BTreeMap::from([(
            String::from("retryWrites"),
            String::from("true"),
        )]),
        tls: true,
        tls_ca_file: Some(String::from("/ca.pem")),
        tls_cert_key_file: Some(String::from("/cert.pem")),
        tls_allow_invalid_certificates: true,
        ssh_enabled: true,
        ssh_host: Some(String::from("bastion")),
        ssh_port: 2222,
        ssh_user: Some(String::from("ubuntu")),
        ssh_auth: Some(String::from("key")),
        ssh_key_file: Some(String::from("/id_ed25519")),
        tag: Some(String::from("red")),
        read_only: true,
        password: Some(String::from("pw")),
        ssh_password: Some(String::from("sshpw")),
        ssh_passphrase: Some(String::from("phrase")),
    }
}

#[test]
fn into_config_carries_every_editable_field() {
    let c = fields().into_config(String::from("c1"), None, None, true);

    assert_eq!(c.name, "prod");
    assert_eq!(c.hosts, vec![HostEntry { host: String::from("db1"), port: 27018 }]);
    assert_eq!(c.connection_type, "replica");
    assert_eq!(c.replica_set_name.as_deref(), Some("rs0"));
    assert_eq!(c.username.as_deref(), Some("admin"));
    assert_eq!(c.auth_db.as_deref(), Some("authdb"));
    assert_eq!(c.auth_mechanism.as_deref(), Some("X509"));
    assert_eq!(c.options.get("retryWrites").map(String::as_str), Some("true"));
    assert_eq!(c.tls, true);
    assert_eq!(c.tls_ca_file.as_deref(), Some("/ca.pem"));
    assert_eq!(c.tls_cert_key_file.as_deref(), Some("/cert.pem"));
    assert_eq!(c.tls_allow_invalid_certificates, true);
    assert_eq!(c.ssh_enabled, true);
    assert_eq!(c.ssh_host.as_deref(), Some("bastion"));
    assert_eq!(c.ssh_port, 2222);
    assert_eq!(c.ssh_user.as_deref(), Some("ubuntu"));
    assert_eq!(c.ssh_auth.as_deref(), Some("key"));
    assert_eq!(c.ssh_key_file.as_deref(), Some("/id_ed25519"));
    assert_eq!(c.tag.as_deref(), Some("red"));
    assert_eq!(c.read_only, true);
}

#[test]
fn into_config_takes_the_non_editable_fields_from_the_caller() {
    // The edit dialog doesn't carry these, so an update must supply the existing
    // record's values rather than let the form blank them.
    let c = fields().into_config(
        String::from("c1"),
        Some(String::from("folder-7")),
        Some(String::from("2026-01-01")),
        false,
    );

    assert_eq!(c.id, "c1");
    assert_eq!(c.folder_id.as_deref(), Some("folder-7"));
    assert_eq!(c.last_accessed.as_deref(), Some("2026-01-01"));
    assert_eq!(c.open, false);
}

#[test]
fn secrets_are_lifted_out_and_never_reach_the_config() {
    let f = fields();
    let (password, ssh_password, ssh_passphrase) = f.secrets();

    assert_eq!(password.as_deref(), Some("pw"));
    assert_eq!(ssh_password.as_deref(), Some("sshpw"));
    assert_eq!(ssh_passphrase.as_deref(), Some("phrase"));

    // `ConnectionConfig` is what gets written to connections.json, so a secret
    // landing in it would be a credential on disk.
    let json = serde_json::to_string(&f.into_config(String::from("c1"), None, None, true)).unwrap();
    assert_eq!(json.contains("pw"), false);
    assert_eq!(json.contains("phrase"), false);
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
