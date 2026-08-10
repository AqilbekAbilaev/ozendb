// Backing for the Import / Export field-mapping wizard. Everything here is
// additive to the existing bare import/export flow:
//   * `coerce` / `apply_field_map` — turn a source column into a typed target
//     field (used by both the mapped import and the field-selecting export).
//   * `import_preview` — read the first N records of a file (reusing the same
//     streaming parsers the importer uses) so the wizard can show columns +
//     sample rows before committing to an import.
//
// The plain `import_collection` / `export_collection` commands (and the Tasks
// paths that call them) are untouched — the mapped variants live alongside them
// in `admin.rs`.

use crate::error::AppError;
use mongodb::bson;
use serde::{Deserialize, Serialize};

/// One column→field mapping. `source` is the column/key in the file (import) or
/// the document (export); `target` is the field/header to write; `kind` is the
/// target type the value is coerced to (see `coerce`). An empty `target` means
/// "drop this column".
#[derive(Deserialize, Clone, Debug)]
pub struct FieldMap {
    pub source: String,
    pub target: String,
    pub kind: String,
}

/// Columns + sample rows read from an import file, handed to the wizard so the
/// user can map before importing.
#[derive(Serialize)]
pub struct ImportPreview {
    pub columns: Vec<String>,
    pub rows: Vec<serde_json::Value>,
}

/// Coerce a BSON value to the target `kind`. Deliberately tolerant: a value that
/// can't be represented as the requested type is returned unchanged rather than
/// dropped, so a single bad cell never aborts an import. `kind` "auto" (or any
/// unknown value) passes the value straight through. A `Null` value stays null
/// for every kind — a blank/missing source shouldn't become `0`, `false`, or an
/// epoch date.
pub fn coerce(value: bson::Bson, kind: &str) -> bson::Bson {
    if let bson::Bson::Null = value {
        return bson::Bson::Null;
    }
    match kind {
        "string" => coerce_string(value),
        "int" => coerce_int(value),
        "long" => coerce_long(value),
        "double" => coerce_double(value),
        "bool" => coerce_bool(value),
        "date" => coerce_date(value),
        "objectId" => coerce_object_id(value),
        _ => value,
    }
}

fn coerce_string(value: bson::Bson) -> bson::Bson {
    let text = match value {
        bson::Bson::String(text) => text,
        bson::Bson::Int32(number) => number.to_string(),
        bson::Bson::Int64(number) => number.to_string(),
        bson::Bson::Double(number) => number.to_string(),
        bson::Bson::Boolean(flag) => flag.to_string(),
        bson::Bson::ObjectId(oid) => oid.to_hex(),
        bson::Bson::DateTime(date) => match date.try_to_rfc3339_string() {
            Ok(text) => text,
            Err(_) => date.to_string(),
        },
        other => serde_json::Value::from(other).to_string(),
    };
    bson::Bson::String(text)
}

fn coerce_int(value: bson::Bson) -> bson::Bson {
    match value {
        bson::Bson::Int32(number) => bson::Bson::Int32(number),
        bson::Bson::Int64(number) => bson::Bson::Int32(number as i32),
        bson::Bson::Double(number) => bson::Bson::Int32(number as i32),
        bson::Bson::Boolean(flag) => bson::Bson::Int32(if flag { 1 } else { 0 }),
        bson::Bson::String(text) => match text.trim().parse::<i32>() {
            Ok(number) => bson::Bson::Int32(number),
            Err(_) => match text.trim().parse::<f64>() {
                Ok(number) => bson::Bson::Int32(number as i32),
                Err(_) => bson::Bson::String(text),
            },
        },
        other => other,
    }
}

fn coerce_long(value: bson::Bson) -> bson::Bson {
    match value {
        bson::Bson::Int64(number) => bson::Bson::Int64(number),
        bson::Bson::Int32(number) => bson::Bson::Int64(number as i64),
        bson::Bson::Double(number) => bson::Bson::Int64(number as i64),
        bson::Bson::Boolean(flag) => bson::Bson::Int64(if flag { 1 } else { 0 }),
        bson::Bson::String(text) => match text.trim().parse::<i64>() {
            Ok(number) => bson::Bson::Int64(number),
            Err(_) => match text.trim().parse::<f64>() {
                Ok(number) => bson::Bson::Int64(number as i64),
                Err(_) => bson::Bson::String(text),
            },
        },
        other => other,
    }
}

fn coerce_double(value: bson::Bson) -> bson::Bson {
    match value {
        bson::Bson::Double(number) => bson::Bson::Double(number),
        bson::Bson::Int32(number) => bson::Bson::Double(number as f64),
        bson::Bson::Int64(number) => bson::Bson::Double(number as f64),
        bson::Bson::Boolean(flag) => bson::Bson::Double(if flag { 1.0 } else { 0.0 }),
        bson::Bson::String(text) => match text.trim().parse::<f64>() {
            Ok(number) => bson::Bson::Double(number),
            Err(_) => bson::Bson::String(text),
        },
        other => other,
    }
}

fn coerce_bool(value: bson::Bson) -> bson::Bson {
    match value {
        bson::Bson::Boolean(flag) => bson::Bson::Boolean(flag),
        bson::Bson::Int32(number) => bson::Bson::Boolean(number != 0),
        bson::Bson::Int64(number) => bson::Bson::Boolean(number != 0),
        bson::Bson::Double(number) => bson::Bson::Boolean(number != 0.0),
        bson::Bson::String(text) => match text.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" | "y" => bson::Bson::Boolean(true),
            "false" | "0" | "no" | "n" => bson::Bson::Boolean(false),
            _ => bson::Bson::String(text),
        },
        other => other,
    }
}

fn coerce_date(value: bson::Bson) -> bson::Bson {
    match value {
        bson::Bson::DateTime(date) => bson::Bson::DateTime(date),
        // A whole number is treated as milliseconds since the Unix epoch.
        bson::Bson::Int64(number) => bson::Bson::DateTime(bson::DateTime::from_millis(number)),
        bson::Bson::Int32(number) => {
            bson::Bson::DateTime(bson::DateTime::from_millis(number as i64))
        }
        bson::Bson::String(text) => match bson::DateTime::parse_rfc3339_str(text.trim()) {
            Ok(date) => bson::Bson::DateTime(date),
            Err(_) => bson::Bson::String(text),
        },
        other => other,
    }
}

fn coerce_object_id(value: bson::Bson) -> bson::Bson {
    match value {
        bson::Bson::ObjectId(oid) => bson::Bson::ObjectId(oid),
        bson::Bson::String(text) => match bson::oid::ObjectId::parse_str(text.trim()) {
            Ok(oid) => bson::Bson::ObjectId(oid),
            Err(_) => bson::Bson::String(text),
        },
        other => other,
    }
}

/// Rewrite `doc` through the mapping: for each `FieldMap` with a non-empty
/// `target`, copy `source`'s value across under the new name, coerced to `kind`.
/// A `source` the document lacks is skipped, so the output holds exactly the
/// mapped-and-present fields, in mapping order (which is how CSV/JSON output
/// column order is derived).
pub fn apply_field_map(doc: &bson::Document, mapping: &[FieldMap]) -> bson::Document {
    let mut out = bson::Document::new();
    for map in mapping {
        if map.target.trim().is_empty() {
            continue;
        }
        match doc.get(&map.source) {
            Some(value) => {
                out.insert(map.target.clone(), coerce(value.clone(), &map.kind));
            }
            None => {}
        }
    }
    out
}

// Sentinel error used to stop the streaming parser once the preview has read
// enough rows; `read_records` recognizes it and treats it as a clean stop rather
// than a parse failure. The parsers have no early-exit hook other than a `flush`
// that returns `Err`, so this is how the preview avoids reading a huge file whole.
const PREVIEW_ENOUGH: &str = "__ozendb_preview_enough__";

// Read up to `limit` documents from an import file, reusing the same streaming
// CSV/JSON parsers the importer uses. Runs on the calling (blocking) thread.
// CSV parsing options as sent from the import UI (all optional; missing fields fall
// back to the historical defaults). `delimiter`/`quote` arrive as strings so the UI
// can send a tab, comma, etc.; only the first byte is used.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvOptionsInput {
    pub delimiter: Option<String>,
    pub quote: Option<String>,
    pub has_headers: Option<bool>,
    pub skip_lines: Option<usize>,
}

impl CsvOptionsInput {
    pub fn to_options(&self) -> crate::commands::CsvOptions {
        let defaults = crate::commands::CsvOptions::default();
        crate::commands::CsvOptions {
            delimiter: first_byte(self.delimiter.as_deref(), defaults.delimiter),
            quote: first_byte(self.quote.as_deref(), defaults.quote),
            has_headers: match self.has_headers {
                Some(value) => value,
                None => defaults.has_headers,
            },
            skip_lines: match self.skip_lines {
                Some(value) => value,
                None => defaults.skip_lines,
            },
        }
    }
}

// The first byte of `text`, or `fallback` when it's absent or empty.
fn first_byte(text: Option<&str>, fallback: u8) -> u8 {
    match text {
        Some(value) => match value.bytes().next() {
            Some(byte) => byte,
            None => fallback,
        },
        None => fallback,
    }
}

fn read_records(
    path: &str,
    format: &str,
    limit: usize,
    csv: crate::commands::CsvOptions,
) -> Result<Vec<bson::Document>, AppError> {
    // An empty file previews as no rows without invoking the parser (which would
    // reject zero-length input as malformed JSON), matching `stream_import`.
    let metadata = match std::fs::metadata(path) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Io(e)),
    };
    if metadata.len() == 0 {
        return Ok(Vec::new());
    }
    let file = match std::fs::File::open(path) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Io(e)),
    };
    let reader = std::io::BufReader::new(file);
    // Ask the parser for batches no larger than the preview limit, so the first
    // full batch already satisfies the request and we can stop.
    let batch_size = if limit == 0 { super::IMPORT_BATCH_SIZE } else { limit };
    let mut rows: Vec<bson::Document> = Vec::new();
    let result = super::stream_documents(reader, format, csv, batch_size, |batch| {
        for doc in batch {
            if limit != 0 && rows.len() >= limit {
                break;
            }
            rows.push(doc);
        }
        if limit != 0 && rows.len() >= limit {
            return Err(AppError::Bson(PREVIEW_ENOUGH.to_string()));
        }
        Ok(())
    });
    match result {
        Ok(_) => Ok(rows),
        Err(AppError::Bson(message)) if message == PREVIEW_ENOUGH => Ok(rows),
        Err(e) => Err(e),
    }
}

// First-seen union of the top-level keys across the sample documents. For CSV
// this reconstructs the header row (each row carries every header in order); for
// JSON it's the union of object keys across the sampled documents.
fn columns_of(docs: &[bson::Document]) -> Vec<String> {
    let mut columns: Vec<String> = Vec::new();
    for doc in docs {
        for (key, _) in doc {
            if !columns.iter().any(|existing| existing == key) {
                columns.push(key.clone());
            }
        }
    }
    columns
}

/// Read the first `limit` records of an import file and report the detected
/// columns plus the sample rows (as JSON), so the wizard can offer a mapping.
/// Parsing is file/CPU work, so it runs on a blocking thread.
#[tauri::command]
pub async fn import_preview(
    path: String,
    format: String,
    limit: usize,
    csv: Option<CsvOptionsInput>,
) -> Result<ImportPreview, AppError> {
    let csv_options = match csv {
        Some(input) => input.to_options(),
        None => crate::commands::CsvOptions::default(),
    };
    let docs = match tokio::task::spawn_blocking(move || read_records(&path, &format, limit, csv_options)).await {
        Ok(Ok(val)) => val,
        Ok(Err(e)) => return Err(e),
        Err(join_err) => return Err(AppError::Bson(format!("Preview task failed: {join_err}"))),
    };
    let columns = columns_of(&docs);
    let rows = docs
        .into_iter()
        .map(|doc| serde_json::Value::from(bson::Bson::Document(doc)))
        .collect();
    Ok(ImportPreview {
        columns: columns,
        rows: rows,
    })
}

/// Stage pasted text (e.g. from the clipboard) as a temp file so the import
/// pipeline — which reads sources by file path — can treat it like any other
/// source. Returns the absolute path of the written file. The files land in the OS
/// temp dir named `ozendb-import-<uuid>.<ext>`; the OS reclaims the temp dir.
#[tauri::command]
pub async fn stage_import_text(content: String, format: String) -> Result<String, AppError> {
    let extension = if format == "csv" { "csv" } else { "json" };
    let file_name = format!("ozendb-import-{}.{}", uuid::Uuid::new_v4(), extension);
    let mut path = std::env::temp_dir();
    path.push(file_name);
    match std::fs::write(&path, content.as_bytes()) {
        Ok(_) => {}
        Err(e) => return Err(AppError::Io(e)),
    }
    match path.to_str() {
        Some(val) => Ok(val.to_string()),
        None => Err(AppError::Bson(
            "Temp file path is not valid UTF-8".to_string(),
        )),
    }
}

// The export wizard samples the target collection through the existing
// `find_documents` command (no new command needed), then selects/renames fields
// through `export_collection_fields` in `admin.rs`.

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson;

    #[test]
    fn coerce_string_from_number_and_bool() {
        assert_eq!(
            coerce(bson::Bson::Int64(42), "string"),
            bson::Bson::String("42".to_string())
        );
        assert_eq!(
            coerce(bson::Bson::Boolean(true), "string"),
            bson::Bson::String("true".to_string())
        );
    }

    #[test]
    fn coerce_int_parses_and_truncates() {
        assert_eq!(
            coerce(bson::Bson::String("17".to_string()), "int"),
            bson::Bson::Int32(17)
        );
        // A float string truncates toward zero.
        assert_eq!(
            coerce(bson::Bson::String("3.9".to_string()), "int"),
            bson::Bson::Int32(3)
        );
        assert_eq!(coerce(bson::Bson::Double(9.7), "int"), bson::Bson::Int32(9));
    }

    #[test]
    fn coerce_long_and_double() {
        assert_eq!(
            coerce(bson::Bson::String("9000000000".to_string()), "long"),
            bson::Bson::Int64(9_000_000_000)
        );
        assert_eq!(
            coerce(bson::Bson::String("2.5".to_string()), "double"),
            bson::Bson::Double(2.5)
        );
        assert_eq!(
            coerce(bson::Bson::Int32(4), "double"),
            bson::Bson::Double(4.0)
        );
    }

    #[test]
    fn coerce_bool_from_strings() {
        assert_eq!(
            coerce(bson::Bson::String("Yes".to_string()), "bool"),
            bson::Bson::Boolean(true)
        );
        assert_eq!(
            coerce(bson::Bson::String("0".to_string()), "bool"),
            bson::Bson::Boolean(false)
        );
        assert_eq!(coerce(bson::Bson::Int32(3), "bool"), bson::Bson::Boolean(true));
    }

    #[test]
    fn coerce_date_from_string_and_millis() {
        match coerce(bson::Bson::String("2020-01-01T00:00:00Z".to_string()), "date") {
            bson::Bson::DateTime(_) => {}
            other => panic!("expected a date, got {:?}", other),
        }
        match coerce(bson::Bson::Int64(1_577_836_800_000), "date") {
            bson::Bson::DateTime(_) => {}
            other => panic!("expected a date, got {:?}", other),
        }
    }

    #[test]
    fn coerce_object_id_from_hex() {
        match coerce(
            bson::Bson::String("507f1f77bcf86cd799439011".to_string()),
            "objectId",
        ) {
            bson::Bson::ObjectId(_) => {}
            other => panic!("expected an ObjectId, got {:?}", other),
        }
    }

    #[test]
    fn coerce_keeps_bad_input_unchanged() {
        // Non-numeric string as int → original string, not dropped.
        assert_eq!(
            coerce(bson::Bson::String("abc".to_string()), "int"),
            bson::Bson::String("abc".to_string())
        );
        // Non-hex string as objectId → original string.
        assert_eq!(
            coerce(bson::Bson::String("nope".to_string()), "objectId"),
            bson::Bson::String("nope".to_string())
        );
        // Unparseable date string → original string.
        assert_eq!(
            coerce(bson::Bson::String("not-a-date".to_string()), "date"),
            bson::Bson::String("not-a-date".to_string())
        );
    }

    #[test]
    fn coerce_null_stays_null_for_every_kind() {
        for kind in ["string", "int", "long", "double", "bool", "date", "objectId"] {
            assert_eq!(coerce(bson::Bson::Null, kind), bson::Bson::Null);
        }
    }

    #[test]
    fn coerce_auto_and_unknown_pass_through() {
        assert_eq!(
            coerce(bson::Bson::Int32(5), "auto"),
            bson::Bson::Int32(5)
        );
        assert_eq!(
            coerce(bson::Bson::Int32(5), "somethingelse"),
            bson::Bson::Int32(5)
        );
    }

    #[test]
    fn apply_field_map_renames_selects_and_coerces() {
        let doc = bson::doc! { "name": "Ann", "age": "30", "extra": "drop me" };
        let mapping = vec![
            FieldMap {
                source: "name".to_string(),
                target: "fullName".to_string(),
                kind: "string".to_string(),
            },
            FieldMap {
                source: "age".to_string(),
                target: "age".to_string(),
                kind: "int".to_string(),
            },
            // Empty target drops the column.
            FieldMap {
                source: "extra".to_string(),
                target: "".to_string(),
                kind: "auto".to_string(),
            },
        ];
        let out = apply_field_map(&doc, &mapping);
        assert_eq!(out.get("fullName"), Some(&bson::Bson::String("Ann".to_string())));
        assert_eq!(out.get("age"), Some(&bson::Bson::Int32(30)));
        assert!(out.get("extra").is_none());
        // Output holds exactly the two mapped fields.
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn apply_field_map_skips_missing_source() {
        let doc = bson::doc! { "a": 1 };
        let mapping = vec![FieldMap {
            source: "missing".to_string(),
            target: "x".to_string(),
            kind: "string".to_string(),
        }];
        let out = apply_field_map(&doc, &mapping);
        assert!(out.is_empty());
    }
}
