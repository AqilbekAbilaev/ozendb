use super::*;
use crate::storage::{ConnectionConfig, HostEntry, MongoConfig};

fn base_config() -> ConnectionConfig {
    ConnectionConfig {
        id: String::from("test"),
        name: String::from("Test"),
        hosts: vec![HostEntry { host: String::from("localhost"), port: 27017 }],
        ..Default::default()
    }
}

/// The MongoDB half of `base_config`, which every `build_uri` call now needs
/// alongside the shared half.
fn base_mongo() -> MongoConfig {
    MongoConfig::default()
}

#[test]
fn build_uri_no_auth() {
    let config = base_config();
    let mongo = base_mongo();
    assert_eq!(build_uri(&config, &mongo, None), "mongodb://localhost:27017/");
}

#[test]
fn build_uri_with_auth() {
    let config = ConnectionConfig {
        username: Some(String::from("alice")),
        ..base_config()
    };
    let mongo = MongoConfig {
        auth_db: Some(String::from("admin")),
        ..Default::default()
    };
    assert_eq!(
        build_uri(&config, &mongo, Some("secret")),
        "mongodb://alice:secret@localhost:27017/?authSource=admin"
    );
}

#[test]
fn build_uri_encodes_special_chars_in_credentials() {
    let config = ConnectionConfig {
        username: Some(String::from("user@example")),
        ..base_config()
    };
    let mongo = MongoConfig {
        auth_db: Some(String::from("admin")),
        ..Default::default()
    };
    let uri = build_uri(&config, &mongo, Some("p@ss:word"));
    assert!(uri.contains("user%40example"));
    assert!(uri.contains("p%40ss%3Aword"));
}

#[test]
fn build_uri_srv_scheme() {
    let config = ConnectionConfig {
        hosts: vec![HostEntry { host: String::from("cluster.example.com"), port: 27017 }],
        ..base_config()
    };
    let mongo = MongoConfig {
        connection_type: String::from("srv"),
        ..Default::default()
    };
    assert!(build_uri(&config, &mongo, None).starts_with("mongodb+srv://"));
    assert!(!build_uri(&config, &mongo, None).contains(":27017"));
}

#[test]
fn build_uri_multi_host_seed_list() {
    let config = ConnectionConfig {
        hosts: vec![
            HostEntry { host: String::from("a.example.com"), port: 27017 },
            HostEntry { host: String::from("b.example.com"), port: 27017 },
            HostEntry { host: String::from("c.example.com"), port: 27018 },
        ],
        ..base_config()
    };
    let mongo = MongoConfig {
        connection_type: String::from("replica"),
        replica_set_name: Some(String::from("rs0")),
        ..Default::default()
    };
    let uri = build_uri(&config, &mongo, None);
    assert!(uri.contains("a.example.com:27017,b.example.com:27017,c.example.com:27018"));
    assert!(uri.contains("replicaSet=rs0"));
}

#[test]
fn build_uri_empty_hosts_falls_back() {
    let config = ConnectionConfig {
        hosts: vec![],
        ..base_config()
    };
    let mongo = base_mongo();
    assert_eq!(build_uri(&config, &mongo, None), "mongodb://localhost:27017/");
}

#[test]
fn build_uri_appends_passthrough_options() {
    let mut options = std::collections::BTreeMap::new();
    options.insert(String::from("retryWrites"), String::from("true"));
    options.insert(String::from("socketTimeoutMS"), String::from("600000"));
    let config = ConnectionConfig {
        ..base_config()
    };
    let mongo = MongoConfig {
        options: options,
        ..Default::default()
    };
    let uri = build_uri(&config, &mongo, None);
    assert!(uri.contains("retryWrites=true"));
    assert!(uri.contains("socketTimeoutMS=600000"));
}

#[test]
fn build_uri_tls_with_files() {
    let config = ConnectionConfig {
        tls: true,
        tls_ca_file: Some(String::from("/etc/ssl/My CA.pem")),
        tls_allow_invalid_certificates: true,
        ..base_config()
    };
    let mongo = MongoConfig {
        tls_cert_key_file: Some(String::from("/etc/ssl/client.pem")),
        ..Default::default()
    };
    let uri = build_uri(&config, &mongo, None);
    assert!(uri.contains("tls=true"));
    // path is percent-encoded ('/' → %2F, ' ' → %20)
    assert!(uri.contains("tlsCAFile=%2Fetc%2Fssl%2FMy%20CA.pem"));
    assert!(uri.contains("tlsCertificateKeyFile=%2Fetc%2Fssl%2Fclient.pem"));
    assert!(uri.contains("tlsAllowInvalidCertificates=true"));
}

#[test]
fn build_uri_no_tls_omits_params() {
    let uri = build_uri(&base_config(), &base_mongo(), None);
    assert!(!uri.contains("tls"));
}

#[test]
fn build_uri_replica_set() {
    let config = ConnectionConfig {
        ..base_config()
    };
    let mongo = MongoConfig {
        connection_type: String::from("replica"),
        replica_set_name: Some(String::from("rs0")),
        ..Default::default()
    };
    assert!(build_uri(&config, &mongo, None).contains("replicaSet=rs0"));
}

#[test]
fn build_uri_username_no_password() {
    let config = ConnectionConfig {
        username: Some(String::from("alice")),
        ..base_config()
    };
    let mongo = MongoConfig {
        auth_db: Some(String::from("admin")),
        ..Default::default()
    };
    let uri = build_uri(&config, &mongo, None);
    assert!(uri.starts_with("mongodb://alice@"));
    assert!(uri.contains("authSource=admin"));
}

#[test]
fn build_uri_auth_mechanism_scram_sha_256() {
    let config = ConnectionConfig {
        username: Some(String::from("alice")),
        ..base_config()
    };
    let mongo = MongoConfig {
        auth_db: Some(String::from("admin")),
        auth_mechanism: Some(String::from("SCRAM-SHA-256")),
        ..Default::default()
    };
    let uri = build_uri(&config, &mongo, Some("secret"));
    assert!(uri.contains("authMechanism=SCRAM-SHA-256"));
}

#[test]
fn build_uri_auth_mechanism_scram_sha_1() {
    let config = ConnectionConfig {
        username: Some(String::from("alice")),
        ..base_config()
    };
    let mongo = MongoConfig {
        auth_db: Some(String::from("admin")),
        auth_mechanism: Some(String::from("SCRAM-SHA-1")),
        ..Default::default()
    };
    let uri = build_uri(&config, &mongo, Some("secret"));
    assert!(uri.contains("authMechanism=SCRAM-SHA-1"));
}

#[test]
fn build_uri_auth_mechanism_plain() {
    let config = ConnectionConfig {
        username: Some(String::from("alice")),
        ..base_config()
    };
    let mongo = MongoConfig {
        auth_db: Some(String::from("$external")),
        auth_mechanism: Some(String::from("PLAIN")),
        ..Default::default()
    };
    let uri = build_uri(&config, &mongo, Some("secret"));
    assert!(uri.contains("authMechanism=PLAIN"));
}

#[test]
fn build_uri_auth_mechanism_none_omits_credentials() {
    let config = ConnectionConfig {
        username: Some(String::from("alice")),
        ..base_config()
    };
    let mongo = MongoConfig {
        auth_mechanism: Some(String::from("none")),
        ..Default::default()
    };
    let uri = build_uri(&config, &mongo, Some("secret"));
    assert!(!uri.contains("alice"));
    assert!(!uri.contains("secret"));
    assert!(!uri.contains("authMechanism"));
}

// --- with_timeout ---

#[test]
fn with_timeout_adds_slash_when_no_path() {
    let result = with_timeout("mongodb://localhost:27017");
    assert!(result.contains("/?"));
    assert!(result.contains("serverSelectionTimeoutMS=5000"));
    assert!(result.contains("connectTimeoutMS=5000"));
}

#[test]
fn with_timeout_preserves_existing_path() {
    let result = with_timeout("mongodb://localhost:27017/mydb");
    assert!(result.starts_with("mongodb://localhost:27017/mydb?"));
}

#[test]
fn with_timeout_appends_to_existing_query() {
    let result = with_timeout("mongodb://localhost:27017/?authSource=admin");
    assert!(result.contains("authSource=admin"));
    assert!(result.contains("serverSelectionTimeoutMS=5000"));
    // Should use & not ?
    assert!(result.contains("admin&server"));
}

#[test]
fn with_timeout_works_with_credentials() {
    let result = with_timeout("mongodb://user:pass@host:27017");
    assert!(result.contains("host:27017/?"));
}

#[test]
fn with_timeout_does_not_override_explicit_values() {
    // An explicit connectTimeoutMS from the URI must not be duplicated.
    let result = with_timeout("mongodb://localhost:27017/?connectTimeoutMS=10000");
    assert!(result.contains("connectTimeoutMS=10000"));
    assert!(!result.contains("connectTimeoutMS=5000"));
    // The unset one still gets the default.
    assert!(result.contains("serverSelectionTimeoutMS=5000"));
}

#[test]
fn with_timeout_works_with_srv_scheme() {
    let result = with_timeout("mongodb+srv://cluster.example.com");
    // SRV URIs have no port path, still gets params appended
    assert!(result.contains("serverSelectionTimeoutMS=5000"));
}

// --- extract_host_port ---

#[test]
fn extract_basic() {
    assert_eq!(
        extract_host_port("mongodb://localhost:27017"),
        Some("localhost:27017".into())
    );
}

#[test]
fn extract_with_database_path() {
    assert_eq!(
        extract_host_port("mongodb://localhost:27017/mydb"),
        Some("localhost:27017".into())
    );
}

#[test]
fn extract_with_credentials() {
    assert_eq!(
        extract_host_port("mongodb://user:pass@prod.example.com:27017"),
        Some("prod.example.com:27017".into())
    );
}

#[test]
fn extract_adds_default_port_when_missing() {
    assert_eq!(
        extract_host_port("mongodb://localhost"),
        Some("localhost:27017".into())
    );
}

#[test]
fn extract_returns_none_for_srv() {
    assert_eq!(extract_host_port("mongodb+srv://cluster.example.com"), None);
}

#[test]
fn extract_returns_none_for_empty_host() {
    assert_eq!(extract_host_port("mongodb://"), None);
}

#[test]
fn extract_takes_first_host_of_seed_list() {
    assert_eq!(
        extract_host_port("mongodb://a.example.com:27017,b.example.com:27017/admin"),
        Some("a.example.com:27017".into())
    );
}

#[test]
fn extract_stops_at_query_string() {
    assert_eq!(
        extract_host_port("mongodb://localhost:27017?authSource=admin"),
        Some("localhost:27017".into())
    );
}

#[test]
fn canonical_mechanism_maps_short_names() {
    assert_eq!(canonical_mechanism("OIDC"), "MONGODB-OIDC");
    assert_eq!(canonical_mechanism("X509"), "MONGODB-X509");
    assert_eq!(canonical_mechanism("AWS"), "MONGODB-AWS");
    assert_eq!(canonical_mechanism("SCRAM-SHA-256"), "SCRAM-SHA-256");
}

#[test]
fn build_uri_oidc_emits_canonical_mechanism_and_properties() {
    let mut options = std::collections::BTreeMap::new();
    options.insert(
        String::from("authMechanismProperties"),
        String::from("ENVIRONMENT:azure,TOKEN_RESOURCE:api://abc"),
    );
    let config = ConnectionConfig {
        ..base_config()
    };
    let mongo = MongoConfig {
        auth_mechanism: Some(String::from("OIDC")),
        options: options,
        ..Default::default()
    };
    let uri = build_uri(&config, &mongo, None);
    // OIDC uses no username → no credentials, no authSource.
    assert!(!uri.contains('@'));
    assert!(!uri.contains("authSource"));
    assert!(uri.contains("authMechanism=MONGODB-OIDC"));
    assert!(uri.contains("authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:api://abc"));
}
