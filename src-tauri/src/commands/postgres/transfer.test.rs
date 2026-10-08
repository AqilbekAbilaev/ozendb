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

#[test]
fn a_source_is_a_table_or_a_query_not_both_or_neither() {
    let table = PgExportSource { schema: Some("public".into()), table: Some("orders".into()), query: None };
    assert!(matches!(table.kind(), Ok(SourceKind::Table("public", "orders"))));
    let query = PgExportSource { schema: None, table: None, query: Some(" SELECT 1; ".into()) };
    assert!(matches!(query.kind(), Ok(SourceKind::Query("SELECT 1"))));
    let neither = PgExportSource { schema: None, table: None, query: None };
    assert!(matches!(neither.kind(), Err(AppError::Validation(_))));
    let both = PgExportSource { schema: Some("public".into()), table: Some("orders".into()), query: Some("SELECT 1".into()) };
    assert!(matches!(both.kind(), Err(AppError::Validation(_))));
}

fn written(rows: &[&str]) -> String {
    let mut out = Vec::new();
    let mut array = JsonArray::default();
    for row in rows {
        array.row(&mut out, row).unwrap();
    }
    array.finish(&mut out).unwrap();
    String::from_utf8(out).unwrap()
}

#[test]
fn json_rows_become_one_array_written_as_they_arrive() {
    assert_eq!(written(&[r#"{"a":1}"#, r#"{"a":2}"#]), "[\n  {\"a\":1},\n  {\"a\":2}\n]\n");
    assert_eq!(written(&[]), "[]\n");
}

#[test]
fn the_json_writer_counts_rows() {
    let mut out = Vec::new();
    let mut array = JsonArray::default();
    array.row(&mut out, "{}").unwrap();
    array.row(&mut out, "{}").unwrap();
    assert_eq!(array.rows, 2);
}

// ── import (#128) ──

fn column(name: &str, generated: bool) -> PgImportColumn {
    PgImportColumn { name: name.into(), data_type: "text".into(), nullable: true, has_default: false, generated }
}

#[test]
fn rows_are_re_encoded_with_empty_fields_as_null() {
    assert_eq!(encode_csv_row(&["1", "plain", ""]), "\"1\",\"plain\",\n");
    assert_eq!(encode_csv_row(&["a \"q\", b", "two\nlines"]), "\"a \"\"q\"\", b\",\"two\nlines\"\n");
}

#[test]
fn headers_map_to_same_named_columns_ignoring_case() {
    let columns = vec![column("id", false), column("Name", false), column("doubled", true)];
    let headers: Vec<String> = ["ID", "name", "doubled", "extra"].iter().map(|h| h.to_string()).collect();
    assert_eq!(auto_mapping(&headers, &columns), vec![Some("id".into()), Some("Name".into()), None, None]);
}

#[test]
fn a_mapping_keeps_its_header_order_and_drops_unmapped_columns() {
    let columns = vec![column("id", false), column("name", false)];
    let mapping = vec![Some("name".to_string()), None, Some("id".to_string())];
    assert_eq!(check_mapping(&mapping, &columns).unwrap(), vec![(0, "name".to_string()), (2, "id".to_string())]);
}

#[test]
fn a_bad_mapping_is_refused() {
    let columns = vec![column("id", false), column("doubled", true)];
    let refused = |mapping: Vec<Option<&str>>| {
        let owned: Vec<Option<String>> = mapping.into_iter().map(|m| m.map(String::from)).collect();
        matches!(check_mapping(&owned, &columns), Err(AppError::Validation(_)))
    };
    assert!(refused(vec![None, None]), "nothing mapped");
    assert!(refused(vec![Some("id"), Some("id")]), "a column mapped twice");
    assert!(refused(vec![Some("missing")]), "an unknown column");
    assert!(refused(vec![Some("doubled")]), "a generated column");
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
