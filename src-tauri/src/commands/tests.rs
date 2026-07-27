use super::*;

// The frontend's query parser emits canonical Extended JSON; these confirm the Rust
// decode (the same `serde_json::from_str::<bson::Bson>` the commands use) yields the
// right BSON types for the tricky cases.

#[test]
fn ejson_objectid_decodes_to_object_id() {
    let doc = parse_ejson_document(r#"{"_id":{"$oid":"507f1f77bcf86cd799439011"}}"#).unwrap();
    assert!(matches!(doc.get("_id"), Some(bson::Bson::ObjectId(_))));
}

#[test]
fn ejson_date_decodes_to_datetime() {
    let doc =
        parse_ejson_document(r#"{"created":{"$date":{"$numberLong":"1704067200000"}}}"#).unwrap();
    assert!(matches!(doc.get("created"), Some(bson::Bson::DateTime(_))));
}

#[test]
fn ejson_regex_decodes_to_regular_expression() {
    let doc =
        parse_ejson_document(r#"{"name":{"$regularExpression":{"pattern":"^jo","options":"i"}}}"#)
            .unwrap();
    assert!(matches!(doc.get("name"), Some(bson::Bson::RegularExpression(_))));
}

#[test]
fn ejson_nested_operator_number_decodes_to_int32() {
    let doc = parse_ejson_document(r#"{"age":{"$gt":{"$numberInt":"18"}}}"#).unwrap();
    let inner = doc.get_document("age").unwrap();
    assert!(matches!(inner.get("$gt"), Some(bson::Bson::Int32(18))));
}

#[test]
fn ejson_string_with_punctuation_is_preserved() {
    let doc = parse_ejson_document(r#"{"note":"hello, world: x"}"#).unwrap();
    match doc.get("note") {
        Some(bson::Bson::String(value)) => assert_eq!(value, "hello, world: x"),
        other => panic!("expected a string, got {:?}", other),
    }
}

#[test]
fn empty_and_braces_decode_to_empty_document() {
    assert!(parse_ejson_document("").unwrap().is_empty());
    assert!(parse_ejson_document("{}").unwrap().is_empty());
}

#[test]
fn non_object_ejson_is_an_error() {
    assert!(parse_ejson_document("[1, 2, 3]").is_err());
}

#[test]
fn smart_quotes_are_normalized_as_a_backstop() {
    let doc = parse_ejson_document("{\u{201C}name\u{201D}:\u{201C}John\u{201D}}").unwrap();
    match doc.get("name") {
        Some(bson::Bson::String(value)) => assert_eq!(value, "John"),
        other => panic!("expected a string, got {:?}", other),
    }
}

#[test]
fn curly_quotes_inside_a_string_value_are_preserved() {
    // Regression: a typographic quote living *inside* a document value must survive the
    // round-trip. The input is already-valid JSON (as `JSON.stringify` emits on a document
    // edit), so the smart-quote backstop must not rewrite the curly quotes into unescaped
    // structural quotes — doing so used to corrupt the JSON and break replace_document.
    let input = "{\"desc\":\"the \u{201C}master bedroom\u{201D}\"}";
    let doc = parse_ejson_document(input).unwrap();
    match doc.get("desc") {
        Some(bson::Bson::String(value)) => {
            assert_eq!(value, "the \u{201C}master bedroom\u{201D}")
        }
        other => panic!("expected a string, got {:?}", other),
    }
}

#[test]
fn pipeline_canonical_ejson_decodes_to_stage_documents() {
    let stages = parse_pipeline(
        r#"[{"$match":{"x":{"$numberInt":"1"}}},{"$group":{"_id":"$y","n":{"$sum":{"$numberInt":"1"}}}}]"#,
    )
    .unwrap();
    assert_eq!(stages.len(), 2);
    assert!(stages[0].contains_key("$match"));
}

#[test]
fn empty_pipeline_decodes_to_no_stages() {
    assert!(parse_pipeline("[]").unwrap().is_empty());
    assert!(parse_pipeline("").unwrap().is_empty());
}

// Paste Document(s) sends the clipboard text straight to `parse_json_documents`, so
// these pin the single-object / array / error behavior the paste relies on.
#[test]
fn paste_accepts_a_single_object() {
    let docs = parse_json_documents(r#"{"name":"Jo","n":{"$numberInt":"3"}}"#).unwrap();
    assert_eq!(docs.len(), 1);
    assert!(matches!(docs[0].get("n"), Some(bson::Bson::Int32(3))));
}

#[test]
fn paste_accepts_an_array_of_objects() {
    let docs = parse_json_documents(r#"[{"a":1},{"a":2},{"a":3}]"#).unwrap();
    assert_eq!(docs.len(), 3);
}

#[test]
fn paste_preserves_ejson_types_for_each_document() {
    let docs =
        parse_json_documents(r#"[{"_id":{"$oid":"507f1f77bcf86cd799439011"}}]"#).unwrap();
    assert!(matches!(docs[0].get("_id"), Some(bson::Bson::ObjectId(_))));
}

#[test]
fn paste_empty_clipboard_yields_no_documents() {
    assert!(parse_json_documents("").unwrap().is_empty());
    assert!(parse_json_documents("   ").unwrap().is_empty());
}

#[test]
fn paste_rejects_unparseable_and_non_object_input() {
    // Malformed JSON is a graceful error, not a panic.
    assert!(parse_json_documents("{not valid").is_err());
    // A bare scalar is not a document.
    assert!(parse_json_documents("42").is_err());
    // An array element that isn't an object is rejected.
    assert!(parse_json_documents(r#"[{"a":1}, 5]"#).is_err());
}

#[test]
fn only_the_id_index_is_protected() {
    // The `_id_` index can never be dropped or hidden; every other name is fair game,
    // including near-misses that merely contain `_id`.
    assert!(is_protected_index("_id_"));
    assert!(!is_protected_index("email_1"));
    assert!(!is_protected_index("_id_2"));
    assert!(!is_protected_index("user_id_1"));
    assert!(!is_protected_index(""));
}

#[test]
fn sort_document_preserves_key_order() {
    // The link the plan was least sure of: JS EJSON.stringify keeps key order, and
    // bson::Document must keep it through serde_json -> BSON so sort fields apply in
    // the order the user wrote them.
    let doc = parse_ejson_document(r#"{"a":{"$numberInt":"1"},"b":{"$numberInt":"-1"}}"#).unwrap();
    let keys: Vec<&str> = doc.keys().map(|k| k.as_str()).collect();
    assert_eq!(keys, vec!["a", "b"]);

    let reversed = parse_ejson_document(r#"{"b":{"$numberInt":"1"},"a":{"$numberInt":"1"}}"#).unwrap();
    let reversed_keys: Vec<&str> = reversed.keys().map(|k| k.as_str()).collect();
    assert_eq!(reversed_keys, vec!["b", "a"]);
}

// ── export formatting ──────────────────────────────────────────
// The streaming exporter (`stream_export`) reads from a live cursor, so its
// Mongo/file orchestration is exercised by the manual smoke test. These cover the
// pure formatting primitives it shares with the buffered `docs_to_json_array` /
// `docs_to_csv` assemblers, so the streamed output is validated byte-for-byte.

#[test]
fn export_json_empty_is_empty_array() {
    assert_eq!(docs_to_json_array(&[]).unwrap(), "[]");
}

#[test]
fn export_json_multi_doc_is_a_valid_json_array() {
    let docs = vec![bson::doc! { "a": 1 }, bson::doc! { "b": "x" }];
    let out = docs_to_json_array(&docs).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&out).unwrap();
    let array = parsed.as_array().unwrap();
    assert_eq!(array.len(), 2);
    assert_eq!(array[0]["a"], serde_json::json!(1));
    assert_eq!(array[1]["b"], serde_json::json!("x"));
}

#[test]
fn export_csv_header_is_union_of_all_keys() {
    let docs = vec![
        bson::doc! { "a": 1, "b": 2 },
        bson::doc! { "a": 3, "c": 4 },
    ];
    let first_line = docs_to_csv(&docs).lines().next().unwrap().to_string();
    assert_eq!(first_line, "a,b,c");
}

#[test]
fn export_csv_missing_key_becomes_an_empty_cell() {
    let docs = vec![bson::doc! { "a": 1, "b": 2 }, bson::doc! { "a": 3 }];
    let out = docs_to_csv(&docs);
    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(lines[0], "a,b");
    assert_eq!(lines[1], "1,2");
    assert_eq!(lines[2], "3,");
}

#[test]
fn export_csv_empty_is_a_single_blank_header_line() {
    // No docs → no headers → a lone newline, matching pre-refactor behavior.
    assert_eq!(docs_to_csv(&[]), "\n");
}

#[test]
fn export_csv_transform_dropping_a_field_removes_its_column() {
    // A transform that removes `secret`: afterwards no document has the
    // key, so it must not appear as a column. The streaming exporter applies the
    // transform in its header pass for exactly this reason; here we apply it first,
    // then assemble.
    let mut docs = vec![
        bson::doc! { "name": "ann", "secret": "s1" },
        bson::doc! { "name": "bob" },
    ];
    for doc in docs.iter_mut() {
        doc.remove("secret");
    }
    let out = docs_to_csv(&docs);
    assert_eq!(out.lines().next().unwrap(), "name");
    assert!(!out.contains("secret"));
}

// ── xlsx export ────────────────────────────────────────────────
// docs_to_xlsx drives the same xlsx_write_document the streaming exporter uses. We can't
// read the workbook back without a reader dependency, so these assert the integration
// runs without panicking across representative BSON types and produces a valid .xlsx
// (which is a ZIP archive, so it starts with the "PK\x03\x04" signature).

fn temp_xlsx_path(tag: &str) -> std::path::PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("ozendb-xlsx-test-{}-{}.xlsx", std::process::id(), tag));
    path
}

#[test]
fn export_xlsx_writes_a_valid_zip_workbook() {
    let docs = vec![
        bson::doc! { "a": 1, "b": "x" },
        bson::doc! { "a": 3, "c": true },
    ];
    let path = temp_xlsx_path("valid");
    let path_str = path.to_str().unwrap();
    let count = docs_to_xlsx(&docs, path_str).unwrap();
    assert_eq!(count, 2);
    let bytes = std::fs::read(&path).unwrap();
    assert!(bytes.starts_with(b"PK\x03\x04"));
    std::fs::remove_file(&path).ok();
}

#[test]
fn export_xlsx_handles_mixed_bson_types_without_error() {
    let object_id = bson::oid::ObjectId::new();
    let docs = vec![bson::doc! {
        "str": "hi",
        "int": 7_i32,
        "long": 9_000_000_000_i64,
        "double": 3.5_f64,
        "bool": false,
        "null": bson::Bson::Null,
        "oid": object_id,
        "nested": bson::doc! { "k": 1 },
        "arr": bson::bson!([1, 2, 3]),
    }];
    let path = temp_xlsx_path("mixed");
    let path_str = path.to_str().unwrap();
    assert!(docs_to_xlsx(&docs, path_str).is_ok());
    std::fs::remove_file(&path).ok();
}

#[test]
fn export_xlsx_empty_produces_a_workbook() {
    let path = temp_xlsx_path("empty");
    let path_str = path.to_str().unwrap();
    let count = docs_to_xlsx(&[], path_str).unwrap();
    assert_eq!(count, 0);
    assert!(path.exists());
    std::fs::remove_file(&path).ok();
}

// ── streaming import (batching layer) ──────────────────────────
// These exercise `stream_documents`, the DB-free core of `stream_import`: it parses an
// import file into batches and hands each batch to a `flush` callback. Here `flush`
// records each batch so we can assert both the total count and where the batch
// boundaries fall. The async `stream_import` wrapper (which feeds batches into
// `insert_many`) needs a live MongoDB and is covered by the manual smoke test.

// Run the streaming importer over `input`, returning the reported total and the list
// of batches (so a test can inspect batch sizes and per-document content).
fn collect_import(
    input: &[u8],
    format: &str,
    batch_size: usize,
) -> Result<(usize, Vec<Vec<bson::Document>>), AppError> {
    let mut batches: Vec<Vec<bson::Document>> = Vec::new();
    let total = match stream_documents(input, format, CsvOptions::default(), batch_size, |batch| {
        batches.push(batch);
        Ok(())
    }) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    Ok((total, batches))
}

#[test]
fn import_json_array_yields_each_document() {
    let (total, batches) =
        collect_import(br#"[{"a":1},{"a":2},{"a":3}]"#, "json", IMPORT_BATCH_SIZE).unwrap();
    assert_eq!(total, 3);
    // One partial batch of 3.
    assert_eq!(batches.len(), 1);
    assert_eq!(batches[0].len(), 3);
}

#[test]
fn import_json_single_object_yields_one_document() {
    let (total, batches) = collect_import(br#"{"a":1}"#, "json", IMPORT_BATCH_SIZE).unwrap();
    assert_eq!(total, 1);
    assert_eq!(batches[0].len(), 1);
}

#[test]
fn import_json_preserves_ejson_types() {
    let (_total, batches) = collect_import(
        br#"[{"_id":{"$oid":"507f1f77bcf86cd799439011"}}]"#,
        "json",
        IMPORT_BATCH_SIZE,
    )
    .unwrap();
    assert!(matches!(
        batches[0][0].get("_id"),
        Some(bson::Bson::ObjectId(_))
    ));
}

#[test]
fn import_empty_json_array_yields_no_documents() {
    let (total, batches) = collect_import(b"[]", "json", IMPORT_BATCH_SIZE).unwrap();
    assert_eq!(total, 0);
    assert!(batches.is_empty());
}

#[test]
fn import_malformed_json_is_an_error() {
    assert!(collect_import(b"{not valid", "json", IMPORT_BATCH_SIZE).is_err());
    // A bare scalar is not a document.
    assert!(collect_import(b"42", "json", IMPORT_BATCH_SIZE).is_err());
    // An array element that isn't an object is rejected.
    assert!(collect_import(br#"[{"a":1}, 5]"#, "json", IMPORT_BATCH_SIZE).is_err());
}

#[test]
fn import_csv_coerces_cells_like_the_old_reader() {
    let (total, batches) =
        collect_import(b"a,b\n1,x\ntrue,\n", "csv", IMPORT_BATCH_SIZE).unwrap();
    assert_eq!(total, 2);
    let docs = &batches[0];
    assert!(matches!(docs[0].get("a"), Some(bson::Bson::Int64(1))));
    match docs[0].get("b") {
        Some(bson::Bson::String(value)) => assert_eq!(value, "x"),
        other => panic!("expected a string, got {:?}", other),
    }
    assert!(matches!(docs[1].get("a"), Some(bson::Bson::Boolean(true))));
    // An empty trailing cell coerces to null, matching `coerce_csv_value`.
    assert!(matches!(docs[1].get("b"), Some(bson::Bson::Null)));
}

#[test]
fn import_csv_handles_quoted_embedded_newline() {
    // A quoted field containing a newline must stay one field / one row — proving the
    // streaming reader does not naively split on '\n'.
    let (total, batches) =
        collect_import(b"name,note\n\"a\",\"line1\nline2\"\n", "csv", IMPORT_BATCH_SIZE)
            .unwrap();
    assert_eq!(total, 1);
    match batches[0][0].get("note") {
        Some(bson::Bson::String(value)) => assert_eq!(value, "line1\nline2"),
        other => panic!("expected a string, got {:?}", other),
    }
}

#[test]
fn import_csv_skips_blank_trailing_rows() {
    // A doubled final newline leaves a blank row that must be skipped, not imported.
    let (total, _batches) = collect_import(b"a\n1\n\n", "csv", IMPORT_BATCH_SIZE).unwrap();
    assert_eq!(total, 1);
}

// Streaming importer over `input` as CSV with explicit parsing options.
fn collect_import_csv(
    input: &[u8],
    options: CsvOptions,
) -> Result<(usize, Vec<Vec<bson::Document>>), AppError> {
    let mut batches: Vec<Vec<bson::Document>> = Vec::new();
    let total = match stream_documents(input, "csv", options, IMPORT_BATCH_SIZE, |batch| {
        batches.push(batch);
        Ok(())
    }) {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    Ok((total, batches))
}

#[test]
fn import_csv_honors_tab_delimiter() {
    let options = CsvOptions {
        delimiter: b'\t',
        quote: b'"',
        has_headers: true,
        skip_lines: 0,
    };
    let (total, batches) = collect_import_csv(b"a\tb\n1\tx\n", options).unwrap();
    assert_eq!(total, 1);
    assert!(matches!(batches[0][0].get("a"), Some(bson::Bson::Int64(1))));
    match batches[0][0].get("b") {
        Some(bson::Bson::String(value)) => assert_eq!(value, "x"),
        other => panic!("expected a string, got {:?}", other),
    }
}

#[test]
fn import_csv_without_header_synthesizes_field_names() {
    let options = CsvOptions {
        delimiter: b',',
        quote: b'"',
        has_headers: false,
        skip_lines: 0,
    };
    // Both rows are data; columns become field1..fieldN.
    let (total, batches) = collect_import_csv(b"1,x\n2,y\n", options).unwrap();
    assert_eq!(total, 2);
    assert!(matches!(batches[0][0].get("field1"), Some(bson::Bson::Int64(1))));
    match batches[0][0].get("field2") {
        Some(bson::Bson::String(value)) => assert_eq!(value, "x"),
        other => panic!("expected a string, got {:?}", other),
    }
}

#[test]
fn import_csv_skips_leading_lines_before_header() {
    let options = CsvOptions {
        delimiter: b',',
        quote: b'"',
        has_headers: true,
        skip_lines: 1,
    };
    // The preamble line is dropped; the header is then "a,b".
    let (total, batches) = collect_import_csv(b"# preamble\na,b\n1,x\n", options).unwrap();
    assert_eq!(total, 1);
    assert!(matches!(batches[0][0].get("a"), Some(bson::Bson::Int64(1))));
}

#[test]
fn import_csv_honors_custom_text_qualifier() {
    let options = CsvOptions {
        delimiter: b',',
        quote: b'\'',
        has_headers: true,
        skip_lines: 0,
    };
    // A single-quote qualifier lets a value contain the delimiter.
    let (total, batches) = collect_import_csv(b"a,b\n'x,y',z\n", options).unwrap();
    assert_eq!(total, 1);
    match batches[0][0].get("a") {
        Some(bson::Bson::String(value)) => assert_eq!(value, "x,y"),
        other => panic!("expected a string, got {:?}", other),
    }
}

#[test]
fn import_empty_csv_yields_no_documents() {
    let (total, batches) = collect_import(b"", "csv", IMPORT_BATCH_SIZE).unwrap();
    assert_eq!(total, 0);
    assert!(batches.is_empty());
}

#[test]
fn import_json_flushes_multiple_batches_across_the_boundary() {
    // 1001 documents at the real batch size must flush as [1000, 1] — proving the
    // importer crosses a batch boundary instead of buffering everything.
    let mut json = String::from("[");
    for i in 0..1001 {
        if i > 0 {
            json.push(',');
        }
        json.push_str(&format!(r#"{{"n":{i}}}"#));
    }
    json.push(']');
    let (total, batches) = collect_import(json.as_bytes(), "json", IMPORT_BATCH_SIZE).unwrap();
    assert_eq!(total, 1001);
    assert_eq!(batches.len(), 2);
    assert_eq!(batches[0].len(), IMPORT_BATCH_SIZE);
    assert_eq!(batches[1].len(), 1);
}

#[test]
fn import_csv_flushes_multiple_batches_across_the_boundary() {
    let mut csv = String::from("n\n");
    for i in 0..1001 {
        csv.push_str(&format!("{i}\n"));
    }
    let (total, batches) = collect_import(csv.as_bytes(), "csv", IMPORT_BATCH_SIZE).unwrap();
    assert_eq!(total, 1001);
    assert_eq!(batches.len(), 2);
    assert_eq!(batches[0].len(), IMPORT_BATCH_SIZE);
    assert_eq!(batches[1].len(), 1);
}
