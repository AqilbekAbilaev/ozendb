use super::{enum_values, is_system_database, table_kind};

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

#[test]
fn reads_an_enum_s_labels_from_its_column_type_in_declared_order() {
    assert_eq!(enum_values("enum('new','paid')"), Some(vec![String::from("new"), String::from("paid")]));
    assert_eq!(enum_values("enum('ü (z)','x,y','')"), Some(vec![String::from("ü (z)"), String::from("x,y"), String::new()]));
}

#[test]
fn unescapes_the_quotes_and_backslashes_mysql_writes_into_an_enum_s_column_type() {
    let labels = enum_values(r"enum('a''b','c\\d','n\nl')").unwrap();
    assert_eq!(labels, [String::from("a'b"), String::from(r"c\d"), String::from("n\nl")]);
}

#[test]
fn gives_no_labels_for_any_other_column_type() {
    assert_eq!(enum_values("set('a','b')"), None);
    assert_eq!(enum_values("varchar(20)"), None);
    assert_eq!(enum_values("int unsigned"), None);
}
