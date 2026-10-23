use super::format_mysql_sql;

#[test]
fn formats_sql_in_mysql_s_own_dialect() {
    let formatted = format_mysql_sql(String::from("select `Straße ü`, 'x\\'y' from t # note\n")).unwrap_err().to_string();
    assert!(formatted.contains("comments"), "{formatted}");
    assert_eq!(format_mysql_sql(String::from("select `Straße ü`, 'x\\'y' from t")).unwrap(), "SELECT\n  `Straße ü`,\n  'x''y'\nFROM\n  t;");
}

#[test]
fn refuses_a_string_with_a_backslash_which_formatting_would_change() {
    for sql in [r"select 'a\\b'", r#"select "\\%""#] {
        assert!(format_mysql_sql(String::from(sql)).unwrap_err().to_string().contains("backslash"), "{sql}");
    }
}
