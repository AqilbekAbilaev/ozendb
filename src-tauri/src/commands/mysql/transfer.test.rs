use super::*;
use serde_json::json;

#[test]
fn csv_quotes_only_what_needs_it_and_tells_null_from_empty() {
    let fields = [None, Some(String::new()), Some(String::from("Straße")), Some(String::from("a, \"b\"")), Some(String::from("two\nlines\r"))];
    assert_eq!(csv_line(&fields), ",\"\",Straße,\"a, \"\"b\"\"\",\"two\nlines\r\"\n");
}

#[test]
fn a_csv_field_is_the_text_the_grid_shows() {
    assert_eq!(csv_text(&Value::Null, false), None);
    assert_eq!(csv_text(&json!("18446744073709551615"), false).as_deref(), Some("18446744073709551615"));
    assert_eq!(csv_text(&json!(-1.5), false).as_deref(), Some("-1.5"));
    assert_eq!(csv_text(&json!("0x00FF"), false).as_deref(), Some("0x00FF"));
}

#[test]
fn a_boolean_is_written_as_the_number_mysql_stores() {
    assert_eq!(csv_text(&json!(true), false).as_deref(), Some("1"));
    assert_eq!(csv_text(&json!(false), false).as_deref(), Some("0"));
}

#[test]
fn a_json_column_is_written_as_json_text() {
    assert_eq!(csv_text(&json!({ "a": [1, "b"] }), true).as_deref(), Some(r#"{"a":[1,"b"]}"#));
    assert_eq!(csv_text(&json!("text"), true).as_deref(), Some(r#""text""#));
}

#[test]
fn a_json_row_keeps_its_columns_in_order() {
    let keys = json_keys(&["zeta", "Ä \"x\"", "alpha"]).unwrap();
    assert_eq!(json_object(&keys, &[json!(1), Value::Null, json!("ü")]), r#"{"zeta":1,"Ä \"x\"":null,"alpha":"ü"}"#);
}

#[test]
fn json_refuses_two_columns_of_one_name() {
    let refusal = json_keys(&["id", "name", "id"]).unwrap_err().user_message();
    assert!(refusal.contains("two columns named id"), "{refusal}");
}

// ── import ──

#[test]
fn a_batch_binds_at_most_a_thousand_rows_and_65535_values() {
    assert_eq!(batch_rows(1), 1000);
    assert_eq!(batch_rows(65), 1000);
    assert_eq!(batch_rows(66), 992);
    assert_eq!(batch_rows(4096), 15);
}

#[test]
fn a_batch_is_sent_at_its_row_limit_or_at_half_the_largest_statement_the_server_takes() {
    let packet = 64 << 20;
    assert!(!batch_full(999, 1 << 20, 1000, packet));
    assert!(batch_full(1000, 1 << 20, 1000, packet));
    assert!(batch_full(400, 32 << 20, 1000, packet));
    assert!(!batch_full(400, (32 << 20) - 1, 1000, packet));
}

#[test]
fn a_failing_row_is_named_by_its_place_in_the_file() {
    assert_eq!(
        describe_insert_failure("Incorrect integer value: 'abc' for column 'n' at row 3", 1001, 1000),
        "Row 1003: Incorrect integer value: 'abc' for column 'n'. Nothing was imported.",
    );
}

#[test]
fn a_failure_with_no_row_names_the_batch() {
    assert_eq!(
        describe_insert_failure("Column 'n' cannot be null", 1001, 1000),
        "Rows 1001–2000: Column 'n' cannot be null. Nothing was imported.",
    );
    assert_eq!(describe_insert_failure("Column 'n' cannot be null", 7, 1), "Row 7: Column 'n' cannot be null. Nothing was imported.");
}
