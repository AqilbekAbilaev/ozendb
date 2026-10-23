use super::{is_system_database, table_kind};

#[test]
fn flags_mysql_s_own_databases_as_system() {
    for name in ["information_schema", "mysql", "performance_schema", "sys"] {
        assert!(is_system_database(name), "{name}");
    }
}

#[test]
fn leaves_an_ordinary_database_alone() {
    assert!(!is_system_database("shop"));
    assert!(!is_system_database("mysql archive"));
    assert!(!is_system_database("Sys"));
}

#[test]
fn reads_views_and_system_views_as_views() {
    assert_eq!(table_kind("VIEW"), "view");
    assert_eq!(table_kind("SYSTEM VIEW"), "view");
    assert_eq!(table_kind("BASE TABLE"), "table");
}
