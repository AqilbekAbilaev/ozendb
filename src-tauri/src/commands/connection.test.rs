use super::*;
use crate::storage::HostEntry;

// A config with no credentials and no SSH — the baseline each test tweaks. Every
// field is spelled out because `ConnectionConfig` has no `Default`.
fn config() -> ConnectionConfig {
    ConnectionConfig {
        id: String::from("c1"),
        name: String::from("test"),
        engine: String::from("mongodb"),
        database: None,
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
        engine: None,
        database: Some(String::from("appdb")),
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
    let c = fields().into_config(String::from("c1"), None, None, None, true).unwrap();

    assert_eq!(c.name, "prod");
    assert_eq!(c.database.as_deref(), Some("appdb"));
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
fn into_config_defaults_engine_to_mongodb_when_absent() {
    // The connection editor doesn't send `engine` yet (MongoDB is the only engine
    // it offers), so an absent or blank value must not become an empty string.
    let c = fields().into_config(String::from("c1"), None, None, None, true).unwrap();
    assert_eq!(c.engine, "mongodb");
}

#[test]
fn into_config_honors_an_explicit_engine() {
    let mut f = fields();
    f.engine = Some(String::from("postgresql"));
    let c = f.into_config(String::from("c1"), None, None, None, true).unwrap();
    assert_eq!(c.engine, "postgresql");
}

#[test]
fn into_config_accepts_postgres_as_a_synonym_for_postgresql() {
    // "postgres" is the spelling sqlx, libpq and the connection-string scheme all
    // use; it must canonicalize to the same stored value as "postgresql" rather
    // than silently falling through to the MongoDB default.
    let mut f = fields();
    f.engine = Some(String::from("postgres"));
    let c = f.into_config(String::from("c1"), None, None, None, true).unwrap();
    assert_eq!(c.engine, "postgresql");
}

#[test]
fn into_config_rejects_an_unknown_engine_instead_of_guessing_mongodb() {
    // A garbled or unsupported engine value must be a loud error, not a silent
    // MongoDB default — a silent default would dial the wrong driver entirely.
    let mut f = fields();
    f.engine = Some(String::from("mysql"));
    let err = f.into_config(String::from("c1"), None, None, None, true).unwrap_err();
    assert_eq!(err.code(), "validation");
}

#[test]
fn into_config_preserves_engine_and_database_from_the_existing_record_on_update() {
    // The edit dialog doesn't carry `engine`/`database` any more than it carries
    // folder_id/last_accessed/open — an edit must not silently re-point a saved
    // Postgres connection at the MongoDB driver just because the form is blank.
    let mut existing = config();
    existing.engine = String::from("postgresql");
    existing.database = Some(String::from("appdb"));

    let mut edited_fields = fields();
    edited_fields.engine = None; // the editor still can't send this
    let c = edited_fields
        .into_config(String::from("c1"), Some(&existing), None, None, true)
        .unwrap();

    assert_eq!(c.engine, "postgresql");
    assert_eq!(c.database.as_deref(), Some("appdb"));
}

#[test]
fn into_config_ignores_a_form_supplied_engine_when_editing() {
    // Pinning test, not an incidental assertion — see the doc comment on
    // `into_config` in fields.rs. Today the editor never sends `fields.engine` on
    // an edit, so this can't happen in practice; once a picker exists and starts
    // sending one, this test starts failing on purpose, so switching a connection's
    // engine on edit becomes a deliberate change to this function rather than a
    // side effect of the picker landing. If you're here because that's exactly
    // what you want: update this test's expectation, don't delete it.
    let mut existing = config();
    existing.engine = String::from("mongodb");

    let mut edited_fields = fields();
    edited_fields.engine = Some(String::from("postgresql"));
    let c = edited_fields
        .into_config(String::from("c1"), Some(&existing), None, None, true)
        .unwrap();

    assert_eq!(c.engine, "mongodb", "existing record wins over the form, even though the form now supplies one");
}

#[test]
fn into_config_takes_the_non_editable_fields_from_the_caller() {
    // The edit dialog doesn't carry these, so an update must supply the existing
    // record's values rather than let the form blank them.
    let c = fields()
        .into_config(
            String::from("c1"),
            None,
            Some(String::from("folder-7")),
            Some(String::from("2026-01-01")),
            false,
        )
        .unwrap();

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
    let json = serde_json::to_string(&f.into_config(String::from("c1"), None, None, None, true).unwrap()).unwrap();
    assert_eq!(json.contains("pw"), false);
    assert_eq!(json.contains("phrase"), false);
}

#[test]
fn a_tested_form_is_dialled_the_way_it_will_be_saved() {
    // Test Connection used to build its own URI in the frontend, which never emitted
    // replicaSet and mapped only OIDC — so a green test said nothing about the
    // connection that got saved. Both paths now run the form through `build_uri`.
    let uri = crate::uri::build_uri(
        &fields().into_config(String::from("c1"), None, None, None, false).unwrap(),
        Some("pw"),
    );

    assert_eq!(uri.contains("replicaSet=rs0"), true, "replica set must reach the URI");
    assert_eq!(uri.contains("authMechanism=MONGODB-X509"), true, "short names are mapped");
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

#[test]
fn the_frontends_payload_deserializes_with_its_secrets() {
    // The exact shape `formFields()` sends. A key that doesn't line up here means the
    // secret silently arrives as None and never reaches the keychain.
    let json = r#"{
        "name": "prod",
        "hosts": [{"host": "db1", "port": 27017}],
        "connectionType": "standalone",
        "replicaSetName": null,
        "options": {},
        "username": "admin",
        "password": "s3cret",
        "authDb": "admin",
        "authMechanism": "SCRAM-SHA-256",
        "tls": false,
        "tlsCaFile": null,
        "tlsCertKeyFile": null,
        "tlsAllowInvalidCertificates": false,
        "sshEnabled": false,
        "sshHost": null,
        "sshPort": 22,
        "sshUser": null,
        "sshAuth": null,
        "sshKeyFile": null,
        "sshPassword": "sshpw",
        "sshPassphrase": "phrase",
        "tag": null,
        "readOnly": false
    }"#;

    let fields: ConnectionFields = serde_json::from_str(json).unwrap();
    let (password, ssh_password, ssh_passphrase) = fields.secrets();

    assert_eq!(password.as_deref(), Some("s3cret"));
    assert_eq!(ssh_password.as_deref(), Some("sshpw"));
    assert_eq!(ssh_passphrase.as_deref(), Some("phrase"));
}
