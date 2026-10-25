use super::*;

#[test]
fn csv_goes_through_copy_with_a_header() {
    assert_eq!(
        wrap_export("SELECT * FROM \"public\".\"orders\"", "csv").unwrap(),
        "COPY (SELECT * FROM \"public\".\"orders\") TO STDOUT WITH (FORMAT csv, HEADER)",
    );
}

#[test]
fn json_reads_each_row_as_its_json_text() {
    assert_eq!(
        wrap_export("SELECT 1 AS a", "json").unwrap(),
        "SELECT row_to_json(t)::text FROM (SELECT 1 AS a) t",
    );
}

#[test]
fn an_unknown_format_is_refused() {
    assert!(matches!(wrap_export("SELECT 1", "xml"), Err(AppError::Validation(_))));
}

// ── import (#128) ──

#[test]
fn rows_are_re_encoded_with_empty_fields_as_null() {
    assert_eq!(encode_csv_row(&["1", "plain", ""]), "\"1\",\"plain\",\n");
    assert_eq!(encode_csv_row(&["a \"q\", b", "two\nlines"]), "\"a \"\"q\"\", b\",\"two\nlines\"\n");
}

#[test]
fn a_copy_failure_names_the_row_and_column() {
    assert_eq!(
        describe_copy_failure("invalid input syntax for type integer: \"abc\"", Some("COPY items, line 3, column id: \"abc\"")),
        "Row 3 (column id): invalid input syntax for type integer: \"abc\". Nothing was imported.",
    );
    assert_eq!(
        describe_copy_failure("null value in column \"id\" violates not-null constraint", Some("COPY items, line 2: \"\"")),
        "Row 2: null value in column \"id\" violates not-null constraint. Nothing was imported.",
    );
    assert_eq!(describe_copy_failure("boom", None), "boom. Nothing was imported.");
}
