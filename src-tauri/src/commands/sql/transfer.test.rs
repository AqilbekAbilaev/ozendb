use super::*;

#[test]
fn a_source_is_a_table_or_a_query_not_both_or_neither() {
    let table = ExportSource { schema: Some("public".into()), table: Some("orders".into()), query: None };
    assert!(matches!(table.kind(), Ok(SourceKind::Table("public", "orders"))));
    let query = ExportSource { schema: None, table: None, query: Some(" SELECT 1; ".into()) };
    assert!(matches!(query.kind(), Ok(SourceKind::Query("SELECT 1"))));
    let neither = ExportSource { schema: None, table: None, query: None };
    assert!(matches!(neither.kind(), Err(AppError::Validation(_))));
    let both = ExportSource { schema: Some("public".into()), table: Some("orders".into()), query: Some("SELECT 1".into()) };
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

fn column(name: &str, generated: bool) -> ImportColumn {
    ImportColumn { name: name.into(), data_type: "text".into(), nullable: true, has_default: false, generated }
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

fn csv_file(text: &str) -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("ведомость, «data».csv");
    std::fs::write(&path, text).unwrap();
    (dir, path.to_string_lossy().into_owned())
}

#[test]
fn data_rows_skip_blank_lines_and_count_only_rows() {
    let (_dir, path) = csv_file("id,name\n1,\"two\nlines\"\n\n , \n2,\n");
    let mut rows = DataRows::open(&path).unwrap();
    assert_eq!(rows.next_row().unwrap(), Some((1, vec!["1".to_string(), "two\nlines".to_string()])));
    assert_eq!(rows.next_row().unwrap(), Some((2, vec!["2".to_string(), String::new()])));
    assert_eq!(rows.next_row().unwrap(), None);
}

#[test]
fn a_row_with_the_wrong_field_count_is_refused_by_its_number() {
    let (_dir, path) = csv_file("id,name\n1,a\n\n2,b,extra\n");
    let mut rows = DataRows::open(&path).unwrap();
    rows.next_row().unwrap();
    let refusal = rows.next_row().unwrap_err().user_message();
    assert_eq!(refusal, "Row 2 has 3 fields; the header has 2. Nothing was imported.");
}

#[test]
fn an_empty_file_has_no_header() {
    let (_dir, path) = csv_file("");
    assert!(matches!(DataRows::open(&path), Err(AppError::Validation(_))));
}

#[test]
fn a_preview_reads_the_header_and_the_first_rows() {
    let (_dir, path) = csv_file("ID,extra\n1,a\n2,b\n3,c\n");
    let preview = preview(&path, vec![column("id", false)], 2).unwrap();
    assert_eq!(preview.headers, ["ID", "extra"]);
    assert_eq!(preview.rows, [["1", "a"], ["2", "b"]]);
    assert_eq!(preview.mapping, [Some("id".to_string()), None]);
}
