use super::{columns_sql, enum_values, foreign_keys, is_system_database, mariadb_default, table_kind, unwidth, MySqlForeignKey};
use crate::mysql::session::Flavor;

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
    let sql = columns_sql(2, Flavor::MySql);
    assert_eq!(sql.matches("WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?").count(), 2);
    assert_eq!(sql.matches("UNION ALL").count(), 1);
    assert!(sql.contains("SELECT 0 AS place,") && sql.contains("SELECT 1 AS place,"));
    assert!(sql.trim_end().ends_with("ORDER BY place, position, constraint_name"));
}

#[test]
fn sends_a_foreign_key_s_databases_as_the_schemas_the_table_tab_names_them_by() {
    let key = MySqlForeignKey {
        from_database: "shop ü".into(),
        from_table: "orders".into(),
        from_columns: vec!["buyer".into()],
        to_database: "склад".into(),
        to_table: "buyers".into(),
        to_columns: vec!["id".into()],
    };
    assert_eq!(
        serde_json::to_value(&key).unwrap(),
        serde_json::json!({ "fromSchema": "shop ü", "fromTable": "orders", "fromColumns": ["buyer"], "toSchema": "склад", "toTable": "buyers", "toColumns": ["id"] })
    );
}

#[test]
fn drops_the_display_width_of_an_int() {
    assert_eq!(unwidth("int(11)"), "int");
}

#[test]
fn drops_the_display_width_but_keeps_the_sign() {
    assert_eq!(unwidth("bigint(20) unsigned"), "bigint unsigned");
}

#[test]
fn drops_the_width_of_a_year() {
    assert_eq!(unwidth("year(4)"), "year");
}

#[test]
fn keeps_the_width_of_a_boolean() {
    assert_eq!(unwidth("tinyint(1)"), "tinyint(1)");
}

#[test]
fn keeps_the_width_of_a_zerofill_int() {
    assert_eq!(unwidth("int(5) unsigned zerofill"), "int(5) unsigned zerofill");
}

#[test]
fn keeps_the_length_of_a_varchar() {
    assert_eq!(unwidth("varchar(10)"), "varchar(10)");
}

#[test]
fn keeps_the_precision_of_a_decimal() {
    assert_eq!(unwidth("decimal(10,2)"), "decimal(10,2)");
}

#[test]
fn reads_a_mariadb_null_default_as_none() {
    assert_eq!(mariadb_default(Some(String::from("NULL"))), None);
}

#[test]
fn reads_a_mariadb_quoted_default_with_its_quotes_undoubled() {
    assert_eq!(mariadb_default(Some(String::from("'it''s'"))), Some(String::from("it's")));
}

#[test]
fn reads_a_mariadb_empty_string_default_as_empty() {
    assert_eq!(mariadb_default(Some(String::from("''"))), Some(String::new()));
}

#[test]
fn reads_a_mariadb_quoted_null_default_as_the_text() {
    assert_eq!(mariadb_default(Some(String::from("'NULL'"))), Some(String::from("NULL")));
}

#[test]
fn leaves_a_mariadb_expression_default_as_it_is() {
    assert_eq!(mariadb_default(Some(String::from("current_timestamp()"))), Some(String::from("current_timestamp()")));
}

#[test]
fn leaves_a_missing_mariadb_default_missing() {
    assert_eq!(mariadb_default(None), None);
}

#[test]
fn reads_json_off_a_check_constraint_only_on_mariadb() {
    assert!(columns_sql(1, Flavor::MariaDb).contains("CHECK_CONSTRAINTS"));
    assert!(!columns_sql(1, Flavor::MySql).contains("CHECK_CONSTRAINTS"));
}
