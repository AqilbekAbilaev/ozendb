use super::format_mysql_sql;

#[test]
fn formats_sql_in_mysql_s_own_dialect() {
    let formatted = format_mysql_sql(String::from("select `Straße ü`, 'x\\'y' from t # note\n")).unwrap_err().to_string();
    assert!(formatted.contains("comments"), "{formatted}");
    assert_eq!(format_mysql_sql(String::from("select `Straße ü`, 'x\\'y' from t")).unwrap(), "SELECT\n  `Straße ü`,\n  'x\\'y'\nFROM\n  t;");
}

#[test]
fn keeps_a_string_s_backslashes_as_written() {
    assert_eq!(format_mysql_sql(String::from(r"select 'a\\b', '\%'")).unwrap(), "SELECT\n  'a\\\\b',\n  '\\%';");
}
