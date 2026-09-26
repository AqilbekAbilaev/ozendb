use super::*;
use super::fields::{EngineFields, MongoFields, PostgresFields};
use crate::storage::{Engine, EngineConfig, HostEntry, MongoConfig, PostgresConfig};

// A config with no credentials and no SSH — the baseline each test tweaks.
fn config() -> ConnectionConfig {
    ConnectionConfig {
        id: String::from("c1"),
        name: String::from("test"),
        hosts: vec![HostEntry { host: String::from("localhost"), port: 27017 }],
        ..Default::default()
    }
}

// A form with every field set to something distinguishable, so a field mapped to the
// wrong place in `into_config` shows up as a mismatch rather than two matching blanks.
fn fields() -> ConnectionFields {
    ConnectionFields {
        name: String::from("prod"),
        engine: EngineFields::Mongo(MongoFields {
            connection_type: String::from("replica"),
            replica_set_name: Some(String::from("rs0")),
            auth_db: Some(String::from("authdb")),
            auth_mechanism: Some(String::from("X509")),
            options: std::collections::BTreeMap::from([(
                String::from("retryWrites"),
                String::from("true"),
            )]),
            tls_cert_key_file: Some(String::from("/cert.pem")),
        }),
        hosts: vec![HostEntry { host: String::from("db1"), port: 27018 }],
        username: Some(String::from("admin")),
        tls: true,
        tls_ca_file: Some(String::from("/ca.pem")),
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
    assert_eq!(c.hosts, vec![HostEntry { host: String::from("db1"), port: 27018 }]);
    assert_eq!(c.username.as_deref(), Some("admin"));
    assert_eq!(c.tls, true);
    assert_eq!(c.tls_ca_file.as_deref(), Some("/ca.pem"));
    assert_eq!(c.tls_allow_invalid_certificates, true);

    // The form's MongoDB half.
    let mongo = c.engine.as_mongo().expect("MongoDB fields build a MongoDB connection");
    assert_eq!(mongo.connection_type, "replica");
    assert_eq!(mongo.replica_set_name.as_deref(), Some("rs0"));
    assert_eq!(mongo.auth_db.as_deref(), Some("authdb"));
    assert_eq!(mongo.auth_mechanism.as_deref(), Some("X509"));
    assert_eq!(mongo.options.get("retryWrites").map(String::as_str), Some("true"));
    assert_eq!(mongo.tls_cert_key_file.as_deref(), Some("/cert.pem"));
    assert_eq!(c.ssh_enabled, true);
    assert_eq!(c.ssh_host.as_deref(), Some("bastion"));
    assert_eq!(c.ssh_port, 2222);
    assert_eq!(c.ssh_user.as_deref(), Some("ubuntu"));
    assert_eq!(c.ssh_auth.as_deref(), Some("key"));
    assert_eq!(c.ssh_key_file.as_deref(), Some("/id_ed25519"));
    assert_eq!(c.tag.as_deref(), Some("red"));
    assert_eq!(c.read_only, true);
}

fn postgres_fields(database: Option<&str>) -> ConnectionFields {
    ConnectionFields {
        engine: EngineFields::Postgres(PostgresFields { database: database.map(String::from) }),
        ..fields()
    }
}

// The payload `formFields()` sends, minus the engine's own keys.
const SHARED_JSON: &str = r#""name": "prod",
    "hosts": [{"host": "db1", "port": 5432}],
    "username": "me", "password": "pw",
    "tls": false, "tlsCaFile": null, "tlsAllowInvalidCertificates": false,
    "sshEnabled": false, "sshHost": null, "sshPort": 22, "sshUser": null,
    "sshAuth": null, "sshKeyFile": null, "sshPassword": null, "sshPassphrase": null,
    "tag": null, "readOnly": false"#;

fn parse(engine_keys: &str) -> Result<ConnectionFields, serde_json::Error> {
    serde_json::from_str(&format!("{{ {SHARED_JSON}, {engine_keys} }}"))
}

#[test]
fn postgres_fields_build_a_postgres_connection_with_its_database() {
    let c = postgres_fields(Some("appdb")).into_config(String::from("c1"), None, None, None, true).unwrap();
    assert_eq!(c.engine_kind(), Engine::Postgres);
    assert_eq!(c.engine.as_postgres().and_then(|p| p.database.as_deref()), Some("appdb"));
}

#[test]
fn a_postgres_payload_needs_no_mongodb_keys() {
    let f = parse(r#""engine": "postgresql", "database": "appdb""#).unwrap();
    assert!(matches!(f.engine, EngineFields::Postgres(ref p) if p.database.as_deref() == Some("appdb")));
}

#[test]
fn postgres_is_accepted_as_a_synonym_for_postgresql() {
    // "postgres" is the spelling sqlx, libpq and the connection-string scheme all use.
    let f = parse(r#""engine": "postgres", "database": null"#).unwrap();
    assert!(matches!(f.engine, EngineFields::Postgres(_)));
}

#[test]
fn a_payload_without_a_known_engine_is_rejected() {
    // A missing or unsupported engine must be a loud error, not a silent MongoDB
    // default — a silent default would dial the wrong driver entirely.
    assert!(parse(r#""engine": "mysql""#).is_err());
    assert!(parse(r#""connectionType": "standalone", "options": {}"#).is_err());
}

#[test]
fn clearing_the_database_on_update_clears_it() {
    // The editor has a Database field, so blank means "use the default", not "keep".
    let mut existing = config();
    existing.engine = EngineConfig::Postgres(PostgresConfig {
        database: Some(String::from("appdb")),
    });

    let c = postgres_fields(None)
        .into_config(String::from("c1"), Some(&existing), None, None, true)
        .unwrap();

    assert_eq!(c.engine.as_postgres().and_then(|p| p.database.as_deref()), None);
}

#[test]
fn an_edit_cannot_switch_a_connection_to_another_engine() {
    // The editor locks the engine on edit; a form for a different engine than the
    // saved record is refused rather than silently applied or ignored.
    let existing = config(); // MongoDB by default
    let err = postgres_fields(Some("appdb"))
        .into_config(String::from("c1"), Some(&existing), None, None, true)
        .unwrap_err();
    assert_eq!(err.code(), "validation");
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
    let config = fields().into_config(String::from("c1"), None, None, None, false).unwrap();
    let uri = crate::uri::build_uri(
        &config,
        config.engine.as_mongo().expect("the form builds a MongoDB connection"),
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
    c.engine = EngineConfig::Mongo(MongoConfig {
        auth_mechanism: Some(String::from("none")),
        ..Default::default()
    });
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
        "engine": "mongodb",
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
