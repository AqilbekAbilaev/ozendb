use super::{classify_generated, classify_identity, is_system_schema};

#[test]
fn flags_postgres_and_information_schema_as_system() {
    assert!(is_system_schema("pg_catalog"));
    assert!(is_system_schema("pg_toast"));
    assert!(is_system_schema("information_schema"));
}

#[test]
fn leaves_an_ordinary_schema_alone() {
    assert!(!is_system_schema("public"));
    assert!(!is_system_schema("app"));
}

#[test]
fn classifies_attidentity() {
    assert_eq!(classify_identity("a"), Some(String::from("always")));
    assert_eq!(classify_identity("d"), Some(String::from("by_default")));
    assert_eq!(classify_identity(""), None);
}

#[test]
fn classifies_attgenerated() {
    assert_eq!(classify_generated("s"), Some(String::from("stored")));
    assert_eq!(classify_generated(""), None);
}
