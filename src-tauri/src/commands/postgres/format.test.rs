use super::format_sql;

#[test]
fn lays_a_query_out_one_clause_per_line() {
    let formatted = format_sql("select id, name from public.users where id > 1 and name ilike 'a%'").unwrap();
    assert_eq!(formatted, "SELECT\n  id,\n  name\nFROM\n  public.users\nWHERE\n  id > 1 AND name ILIKE 'a%';");
}

#[test]
fn keeps_each_statement_and_ends_each_with_a_semicolon() {
    let formatted = format_sql("select 1; update t set a = 2 where id = $1").unwrap();
    assert_eq!(formatted, "SELECT\n  1;\n\nUPDATE t\nSET\n  a = 2\nWHERE\n  id = $1;");
}

#[test]
fn keeps_quoted_names_and_casts() {
    let formatted = format_sql(r#"select "Weird Name", '{1,2}'::int[] from "S"."T""#).unwrap();
    assert!(formatted.contains(r#""Weird Name""#));
    assert!(formatted.contains(r#""S"."T""#));
    assert!(formatted.contains("'{1,2}'::INT[]"));
}

#[test]
fn refuses_sql_with_comments_rather_than_drop_them() {
    for sql in ["select 1 -- why\n", "select /* why */ 1"] {
        let err = format_sql(sql).unwrap_err();
        assert!(err.contains("comments"), "{err}");
    }
    // A comment marker inside a string is not a comment.
    assert!(format_sql("select '-- not a comment'").is_ok());
}

#[test]
fn says_why_sql_it_cannot_read_is_left_alone() {
    assert!(format_sql("selec 1").is_err());
    assert!(format_sql("   ").is_err());
}
