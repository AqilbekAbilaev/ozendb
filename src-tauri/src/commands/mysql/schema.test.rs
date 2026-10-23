use super::{columns_sql, enum_values, foreign_keys, is_system_database, table_kind, MySqlForeignKey};

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

fn key_column(database: &str, table: &str, constraint: &str, column: &str, to: &str) -> (String, String, String, String, String, String, String) {
    (database.into(), table.into(), constraint.into(), column.into(), "склад, b".into(), "bins".into(), to.into())
}

#[test]
fn gathers_a_key_s_columns_in_order_and_keeps_keys_apart() {
    let keys = foreign_keys(vec![
        key_column("shop", "shelf ü", "place, 1", "at slot", "slot"),
        key_column("shop", "shelf ü", "place, 1", "at zone", "zone"),
        key_column("shop", "shelf ü", "place, 2", "at slot", "slot"),
        key_column("shop", "rack", "place, 1", "at slot", "slot"),
    ]);
    let key = |table: &str, from: &[&str], to: &[&str]| MySqlForeignKey {
        from_database: "shop".into(),
        from_table: table.into(),
        from_columns: from.iter().map(|c| c.to_string()).collect(),
        to_database: "склад, b".into(),
        to_table: "bins".into(),
        to_columns: to.iter().map(|c| c.to_string()).collect(),
    };
    assert_eq!(
        keys,
        [key("shelf ü", &["at slot", "at zone"], &["slot", "zone"]), key("shelf ü", &["at slot"], &["slot"]), key("rack", &["at slot"], &["slot"])]
    );
}

#[test]
fn reads_every_table_s_columns_in_one_query_each_table_looked_up_by_equality() {
    let sql = columns_sql(2);
    assert_eq!(sql.matches("WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?").count(), 2);
    assert_eq!(sql.matches("UNION ALL").count(), 1);
    assert!(sql.contains("SELECT 0 AS place,") && sql.contains("SELECT 1 AS place,"));
    assert!(sql.trim_end().ends_with("ORDER BY place, position, constraint_name"));
}
