use super::is_system_schema;

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
