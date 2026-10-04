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
