use crate::error::AppError;
use mongodb::bson;
use mongodb::Collection;
use std::io::Write;
use std::time::Duration;

// Quote a CSV field only when it contains a delimiter, quote, or newline, doubling
// any embedded quotes — standard RFC-4180 escaping.
pub(crate) fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

// Render a single BSON value as a flat CSV cell. Scalars become their plain text;
// anything nested (documents, arrays, dates) falls back to its JSON form.
fn bson_to_csv_cell(value: &bson::Bson) -> String {
    match value {
        bson::Bson::String(val) => val.clone(),
        bson::Bson::Boolean(val) => val.to_string(),
        bson::Bson::Int32(val) => val.to_string(),
        bson::Bson::Int64(val) => val.to_string(),
        bson::Bson::Double(val) => val.to_string(),
        bson::Bson::Null => String::new(),
        bson::Bson::ObjectId(val) => val.to_hex(),
        other => serde_json::Value::from(other.clone()).to_string(),
    }
}

// Adds any of `doc`'s keys not already present to `headers`, in first-seen order.
// Called once per document while building the CSV header union.
fn csv_collect_headers(headers: &mut Vec<String>, doc: &bson::Document) {
    for (key, _) in doc {
        if !headers.iter().any(|existing| existing == key) {
            headers.push(key.clone());
        }
    }
}

// One CSV row (in `headers` column order) for a document; a key the document
// lacks becomes an empty cell.
fn csv_format_row(headers: &[String], doc: &bson::Document) -> String {
    let row: Vec<String> = headers
        .iter()
        .map(|header| match doc.get(header) {
            Some(value) => csv_escape(&bson_to_csv_cell(value)),
            None => String::new(),
        })
        .collect();
    row.join(",")
}

// Pretty-prints one document as an element of a JSON array, prefixed with the
// separator for its position (the first element has none). Shared by the
// streaming exporter and the test-only `docs_to_json_array`, so the streamed and
// the tested output are byte-identical.
fn json_array_element(doc: &bson::Document, first: bool) -> Result<String, AppError> {
    let value = serde_json::Value::from(bson::Bson::Document(doc.clone()));
    let pretty = match serde_json::to_string_pretty(&value) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Serde(e)),
    };
    let prefix = if first { "\n" } else { ",\n" };
    Ok(format!("{}{}", prefix, pretty))
}

// Buffered whole-slice assemblers built from the same primitives the streaming
// exporter uses. Compiled in test builds only — the app streams via
// `stream_export`; these exist so the CSV/JSON formatting can be unit-tested
// without a live MongoDB cursor.
#[cfg(test)]
pub(crate) fn docs_to_csv(docs: &[bson::Document]) -> String {
    let mut headers: Vec<String> = Vec::new();
    for doc in docs {
        csv_collect_headers(&mut headers, doc);
    }
    let mut out = String::new();
    let header_line: Vec<String> = headers.iter().map(|h| csv_escape(h)).collect();
    out.push_str(&header_line.join(","));
    out.push('\n');
    for doc in docs {
        out.push_str(&csv_format_row(&headers, doc));
        out.push('\n');
    }
    out
}

#[cfg(test)]
pub(crate) fn docs_to_json_array(docs: &[bson::Document]) -> Result<String, AppError> {
    let mut out = String::from("[");
    for (index, doc) in docs.iter().enumerate() {
        let element = match json_array_element(doc, index == 0) {
            Ok(val) => val,
            Err(e) => return Err(e),
        };
        out.push_str(&element);
    }
    if !docs.is_empty() {
        out.push('\n');
    }
    out.push(']');
    Ok(out)
}

// Writes `bytes` to `writer`, mapping any I/O error to `AppError`. Keeps the
// streaming exporter free of repeated match blocks.
fn write_bytes<W: Write>(writer: &mut W, bytes: &[u8]) -> Result<(), AppError> {
    match writer.write_all(bytes) {
        Ok(_) => Ok(()),
        Err(e) => Err(AppError::Io(e)),
    }
}

// Opens a fresh cursor for one export pass, applying the optional server-side
// time cap and row limit. A separate function so the CSV two-pass path can
// re-open an identical cursor for its second scan.
async fn export_cursor(
    col: &Collection<bson::Document>,
    filter: bson::Document,
    limit: Option<i64>,
    max_time: Option<Duration>,
) -> Result<mongodb::Cursor<bson::Document>, AppError> {
    let mut query = col.find(filter);
    if let Some(duration) = max_time {
        query = query.max_time(duration);
    }
    if let Some(value) = limit {
        if value > 0 {
            query = query.limit(value);
        }
    }
    match query.await {
        Ok(val) => Ok(val),
        Err(e) => Err(AppError::Mongo(e)),
    }
}

/// Streams a collection to `path` as JSON or CSV without ever holding the whole
/// result set in memory: documents are read from the cursor one at a time,
/// transformed, and written straight to a buffered file. `transform` lets the
/// caller post-process each document; plain export passes a no-op. Returns the number
/// of documents written.
///
/// JSON is a single streaming pass. CSV needs the full header union up front, so
/// it makes two passes over the collection (pass 1 collects headers, pass 2 writes
/// rows) — this assumes the collection isn't mutated between the passes.
/// `transform` runs in both CSV passes because a rule can drop a key, which must
/// be reflected in the header union.
pub(crate) async fn stream_export<F>(
    col: &Collection<bson::Document>,
    filter: bson::Document,
    limit: Option<i64>,
    max_time: Option<Duration>,
    path: &str,
    format: &str,
    mut transform: F,
) -> Result<usize, AppError>
where
    F: FnMut(&mut bson::Document) -> Result<(), AppError>,
{
    if format == "csv" {
        return stream_export_csv(col, filter, limit, max_time, path, &mut transform).await;
    }
    if format == "xlsx" {
        return stream_export_xlsx(col, filter, limit, max_time, path, &mut transform).await;
    }
    let file = match std::fs::File::create(path) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Io(e)),
    };
    let mut writer = std::io::BufWriter::new(file);
    match write_bytes(&mut writer, b"[") {
        Ok(_) => {}
        Err(e) => return Err(e),
    }
    let mut cursor = match export_cursor(col, filter, limit, max_time).await {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let mut count: usize = 0;
    loop {
        let has_next = match cursor.advance().await {
            Ok(val) => val,
            Err(e) => return Err(AppError::Mongo(e)),
        };
        if !has_next {
            break;
        }
        let mut doc: bson::Document = match cursor.deserialize_current() {
            Ok(val) => val,
            Err(e) => return Err(AppError::Mongo(e)),
        };
        match transform(&mut doc) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
        let element = match json_array_element(&doc, count == 0) {
            Ok(val) => val,
            Err(e) => return Err(e),
        };
        match write_bytes(&mut writer, element.as_bytes()) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
        count += 1;
    }
    if count > 0 {
        match write_bytes(&mut writer, b"\n") {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
    }
    match write_bytes(&mut writer, b"]") {
        Ok(_) => {}
        Err(e) => return Err(e),
    }
    match writer.flush() {
        Ok(_) => Ok(count),
        Err(e) => Err(AppError::Io(e)),
    }
}

// CSV branch of `stream_export`: two passes (headers, then rows). Split out to
// keep `stream_export` readable.
async fn stream_export_csv<F>(
    col: &Collection<bson::Document>,
    filter: bson::Document,
    limit: Option<i64>,
    max_time: Option<Duration>,
    path: &str,
    transform: &mut F,
) -> Result<usize, AppError>
where
    F: FnMut(&mut bson::Document) -> Result<(), AppError>,
{
    // Pass 1: header union (transform applied, since a rule can drop keys).
    let mut headers: Vec<String> = Vec::new();
    let mut cursor = match export_cursor(col, filter.clone(), limit, max_time).await {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    loop {
        let has_next = match cursor.advance().await {
            Ok(val) => val,
            Err(e) => return Err(AppError::Mongo(e)),
        };
        if !has_next {
            break;
        }
        let mut doc: bson::Document = match cursor.deserialize_current() {
            Ok(val) => val,
            Err(e) => return Err(AppError::Mongo(e)),
        };
        match transform(&mut doc) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
        csv_collect_headers(&mut headers, &doc);
    }
    // Pass 2: header line, then one row per document.
    let file = match std::fs::File::create(path) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Io(e)),
    };
    let mut writer = std::io::BufWriter::new(file);
    let header_line: Vec<String> = headers.iter().map(|h| csv_escape(h)).collect();
    let mut header_out = header_line.join(",");
    header_out.push('\n');
    match write_bytes(&mut writer, header_out.as_bytes()) {
        Ok(_) => {}
        Err(e) => return Err(e),
    }
    let mut count: usize = 0;
    let mut cursor = match export_cursor(col, filter, limit, max_time).await {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    loop {
        let has_next = match cursor.advance().await {
            Ok(val) => val,
            Err(e) => return Err(AppError::Mongo(e)),
        };
        if !has_next {
            break;
        }
        let mut doc: bson::Document = match cursor.deserialize_current() {
            Ok(val) => val,
            Err(e) => return Err(AppError::Mongo(e)),
        };
        match transform(&mut doc) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
        let mut row = csv_format_row(&headers, &doc);
        row.push('\n');
        match write_bytes(&mut writer, row.as_bytes()) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
        count += 1;
    }
    match writer.flush() {
        Ok(_) => Ok(count),
        Err(e) => Err(AppError::Io(e)),
    }
}

/// XLSX branch of `stream_export`. Unlike the CSV/JSON paths (which stream straight to
/// disk), rust_xlsxwriter assembles the workbook in memory and writes it on `save`, so an
/// xlsx export is bounded by Excel's sheet limits and the caller's row limit rather than
/// being fully streaming — CSV/JSON remain the choice for very large collections. Columns
/// are the first-seen union of document keys (same order as the CSV export); header cells
/// are written lazily as new keys appear, so a single cursor pass suffices.
async fn stream_export_xlsx<F>(
    col: &Collection<bson::Document>,
    filter: bson::Document,
    limit: Option<i64>,
    max_time: Option<Duration>,
    path: &str,
    transform: &mut F,
) -> Result<usize, AppError>
where
    F: FnMut(&mut bson::Document) -> Result<(), AppError>,
{
    // Excel's row limit. Row 0 holds the header, leaving MAX_DATA_ROWS for data. (The
    // column limit is enforced in xlsx_write_document, where columns are assigned.)
    const MAX_DATA_ROWS: usize = 1_048_575;

    let mut workbook = rust_xlsxwriter::Workbook::new();
    let header_format = rust_xlsxwriter::Format::new().set_bold();
    let worksheet = workbook.add_worksheet();

    // First-seen key → column index, so each key maps to a stable column.
    let mut columns: std::collections::HashMap<String, u16> = std::collections::HashMap::new();
    let mut next_col: u16 = 0;

    let mut cursor = match export_cursor(col, filter, limit, max_time).await {
        Ok(val) => val,
        Err(e) => return Err(e),
    };
    let mut count: usize = 0;
    loop {
        let has_next = match cursor.advance().await {
            Ok(val) => val,
            Err(e) => return Err(AppError::Mongo(e)),
        };
        if !has_next {
            break;
        }
        if count >= MAX_DATA_ROWS {
            return Err(AppError::Validation(
                "This export exceeds Excel's limit of 1,048,575 rows. Add a row limit or export as CSV.".to_string(),
            ));
        }
        let mut doc: bson::Document = match cursor.deserialize_current() {
            Ok(val) => val,
            Err(e) => return Err(AppError::Mongo(e)),
        };
        match transform(&mut doc) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
        let data_row: u32 = (count + 1) as u32; // row 0 is the header
        match xlsx_write_document(worksheet, &mut columns, &mut next_col, &header_format, data_row, &doc) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
        count += 1;
    }
    match workbook.save(path) {
        Ok(_) => Ok(count),
        Err(e) => Err(xlsx_error(e)),
    }
}

// Write one document as a worksheet row at `data_row`, assigning any newly-seen key its
// own column (and writing that column's bold header cell on first sight). Shared by the
// streaming exporter and the tests so their output stays identical.
fn xlsx_write_document(
    worksheet: &mut rust_xlsxwriter::Worksheet,
    columns: &mut std::collections::HashMap<String, u16>,
    next_col: &mut u16,
    header_format: &rust_xlsxwriter::Format,
    data_row: u32,
    doc: &bson::Document,
) -> Result<(), AppError> {
    const MAX_COLS: usize = 16_384;
    for (key, value) in doc {
        let col_index = match columns.get(key) {
            Some(existing) => *existing,
            None => {
                if columns.len() >= MAX_COLS {
                    return Err(AppError::Validation(
                        "This export exceeds Excel's limit of 16,384 columns. Export as CSV or JSON instead.".to_string(),
                    ));
                }
                let assigned = *next_col;
                columns.insert(key.clone(), assigned);
                *next_col += 1;
                match worksheet.write_string_with_format(0, assigned, key.as_str(), header_format) {
                    Ok(_) => {}
                    Err(e) => return Err(xlsx_error(e)),
                }
                assigned
            }
        };
        match xlsx_write_cell(worksheet, data_row, col_index, value) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

// Buffered whole-slice xlsx assembler used only in tests, mirroring `docs_to_csv`: it
// drives the same `xlsx_write_document` the streaming exporter uses, so the tested and
// the streamed workbook are built identically.
#[cfg(test)]
pub(crate) fn docs_to_xlsx(docs: &[bson::Document], path: &str) -> Result<usize, AppError> {
    let mut workbook = rust_xlsxwriter::Workbook::new();
    let header_format = rust_xlsxwriter::Format::new().set_bold();
    let worksheet = workbook.add_worksheet();
    let mut columns: std::collections::HashMap<String, u16> = std::collections::HashMap::new();
    let mut next_col: u16 = 0;
    for (index, doc) in docs.iter().enumerate() {
        let data_row: u32 = (index + 1) as u32;
        match xlsx_write_document(worksheet, &mut columns, &mut next_col, &header_format, data_row, doc) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
    }
    match workbook.save(path) {
        Ok(_) => Ok(docs.len()),
        Err(e) => Err(xlsx_error(e)),
    }
}

// A file-writing failure from rust_xlsxwriter isn't user input, so report it as I/O.
fn xlsx_error(e: rust_xlsxwriter::XlsxError) -> AppError {
    AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
}

// Write one BSON value into a worksheet cell, using a native Excel type where it maps
// cleanly (numbers, booleans) and the CSV text form for everything else. `Null` is left
// as a blank cell.
fn xlsx_write_cell(
    worksheet: &mut rust_xlsxwriter::Worksheet,
    row: u32,
    col: u16,
    value: &bson::Bson,
) -> Result<(), AppError> {
    let result = match value {
        bson::Bson::Null => return Ok(()),
        bson::Bson::Boolean(val) => worksheet.write_boolean(row, col, *val),
        bson::Bson::Int32(val) => worksheet.write_number(row, col, *val as f64),
        bson::Bson::Int64(val) => worksheet.write_number(row, col, *val as f64),
        bson::Bson::Double(val) => worksheet.write_number(row, col, *val),
        other => worksheet.write_string(row, col, bson_to_csv_cell(other)),
    };
    match result {
        Ok(_) => Ok(()),
        Err(e) => Err(xlsx_error(e)),
    }
}

/// Advance a document cursor by one, returning the next document or `None` at the
/// end. The single place the advance/deserialize dance lives — every command loop
/// that reads documents goes through here.
pub(crate) async fn next_document(
    cursor: &mut mongodb::Cursor<bson::Document>,
) -> Result<Option<bson::Document>, AppError> {
    let has_next = cursor.advance().await?;
    if !has_next {
        return Ok(None);
    }
    match cursor.deserialize_current() {
        Ok(val) => Ok(Some(val)),
        Err(e) => Err(AppError::Mongo(e)),
    }
}

/// Drain a document cursor fully into a `Vec<Document>`. (Shape B.)
pub(crate) async fn collect_documents(
    cursor: &mut mongodb::Cursor<bson::Document>,
) -> Result<Vec<bson::Document>, AppError> {
    let mut docs = Vec::new();
    loop {
        match next_document(cursor).await {
            Ok(Some(doc)) => docs.push(doc),
            Ok(None) => break,
            Err(e) => return Err(e),
        }
    }
    Ok(docs)
}

/// Drain a document cursor fully into JSON values. (Shape A.) Uses bson's own `From`
/// impl (not `serde_json::to_value`) — matching the existing sites, because bson's
/// Serialize targets the bson wire format, not JSON.
pub(crate) async fn collect_values(
    cursor: &mut mongodb::Cursor<bson::Document>,
) -> Result<Vec<serde_json::Value>, AppError> {
    let docs = collect_documents(cursor).await?;
    Ok(docs
        .into_iter()
        .map(|doc| serde_json::Value::from(bson::Bson::Document(doc)))
        .collect())
}

/// Drain a document cursor into a single pre-serialized JSON array, returned as a
/// `RawValue` so Tauri's IPC layer emits its bytes verbatim (the frontend still
/// receives a normal array). Unlike `collect_values`, this streams one document at a
/// time: the whole `Vec<Value>` intermediate never exists and Tauri never walks a
/// value tree to re-serialize it, so only a single document/value is alive at any
/// moment. That cuts peak memory on large result sets to roughly the size of the JSON
/// text itself. (Shape A, streamed.) Per-doc conversion still goes through bson's own
/// `From` impl, matching `collect_values` — bson's `Serialize` targets the wire format.
pub(crate) async fn collect_json(
    cursor: &mut mongodb::Cursor<bson::Document>,
) -> Result<Box<serde_json::value::RawValue>, AppError> {
    let mut buf = String::from("[");
    let mut first = true;
    loop {
        match next_document(cursor).await {
            Ok(Some(doc)) => {
                let value = serde_json::Value::from(bson::Bson::Document(doc));
                let text = match serde_json::to_string(&value) {
                    Ok(val) => val,
                    Err(e) => return Err(AppError::Serde(e)),
                };
                if !first {
                    buf.push(',');
                }
                first = false;
                buf.push_str(&text);
            }
            Ok(None) => break,
            Err(e) => return Err(e),
        }
    }
    buf.push(']');
    match serde_json::value::RawValue::from_string(buf) {
        Ok(val) => Ok(val),
        Err(e) => return Err(AppError::Serde(e)),
    }
}
