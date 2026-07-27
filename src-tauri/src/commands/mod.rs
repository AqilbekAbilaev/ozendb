use crate::error::AppError;
use crate::pool::ConnectionPool;
use crate::storage::Storage;
use mongodb::bson;
use mongodb::Client;
use mongodb::Collection;
use serde::Serialize;
use std::io::Write;
use std::time::Duration;

pub mod connection;
pub mod query;
pub mod admin;
pub mod persistence;
pub mod shell;
pub mod schema;
pub mod sql;
pub mod stats;
pub mod duplicate;
pub mod serverinfo;
pub mod profiler;
pub mod search;
pub mod gridfs;
pub mod users;
pub mod functions;
pub mod mapreduce;
pub mod copyops;
pub mod folders;
pub mod portmap;
pub mod history;
pub mod operations;

pub use connection::*;
pub use query::*;
pub use admin::*;
pub use persistence::*;
pub use shell::*;
pub use schema::*;
pub use sql::*;
pub use stats::*;
pub use duplicate::*;
pub use serverinfo::*;
pub use profiler::*;
pub use search::*;
pub use gridfs::*;
pub use users::*;
pub use functions::*;
pub use mapreduce::*;
pub use copyops::*;
pub use folders::*;
pub use portmap::*;
pub use history::*;
pub use operations::*;

// Server-side time cap on user queries so a runaway find/aggregate aborts on the
// server instead of hanging the UI (Tauri commands can't be cancelled in-flight).
pub(crate) const MAX_QUERY_TIME: Duration = Duration::from_secs(60);

/// Unwrap a `Result<T, AppError>` or early-return with the error.
/// Replaces the 4-line `match expr { Ok(v) => v, Err(e) => return Err(e) }`
/// pattern that appears dozens of times across command files.
#[macro_export]
macro_rules! resolve {
    ($expr:expr) => {
        match $expr {
            Ok(val) => val,
            Err(e) => return Err(e),
        }
    };
}

/// Record a long-running operation in the Operations registry (the one place all
/// operations are tracked) while it runs, without changing what the command returns.
/// Pass `Some(meta)` to track (a `running` record is inserted, then stamped
/// `succeeded`/`failed` from the outcome) or `None` to run untracked — so a single
/// call site can decide per-invocation whether an op is worth logging (e.g. only
/// user-initiated query runs, not internal sampling reads). The awaited value is
/// returned verbatim so callers wrap their existing body with no other change.
pub(crate) async fn tracked<F, T>(
    registry: &crate::operations::OperationsRegistry,
    meta: Option<crate::operations::OpMeta>,
    fut: F,
) -> Result<T, AppError>
where
    F: std::future::Future<Output = Result<T, AppError>>,
{
    let id = match meta {
        Some(op_meta) => Some(registry.start(op_meta)),
        None => None,
    };
    let result = fut.await;
    if let Some(op_id) = id {
        match &result {
            Ok(_) => registry.finish(&op_id, "succeeded", None),
            Err(e) => registry.finish(&op_id, "failed", Some(e.to_string())),
        }
    }
    result
}

/// Resolve the live MongoDB client for a saved connection: look up its config and
/// hand off to the pool, which caches the client and reads credentials from the
/// keychain only when it actually opens a new connection. Every command that
/// operates on a connection goes through here, so the config-lookup + connect
/// dance lives in exactly one place (and the keychain read stays off the hot path).
pub(crate) async fn client_for(
    pool: &ConnectionPool,
    storage: &Storage,
    id: &str,
) -> Result<Client, AppError> {
    let config = match storage.find(id) {
        Some(val) => val,
        None => return Err(AppError::UnknownConnection(id.to_string())),
    };
    pool.connect(&config).await
}

/// The write-gated sibling of `client_for`: every mutating command resolves its
/// client through here instead, so a connection flagged `read_only` is refused at a
/// single choke point before any write reaches the driver. Non-read-only
/// connections fall straight through to `client_for`.
///
/// NOTE: IntelliShell shell writes take a separate path (see shell/bridge.rs) and
/// are NOT yet gated by this check — a documented known limitation.
pub(crate) async fn client_for_write(
    pool: &ConnectionPool,
    storage: &Storage,
    id: &str,
) -> Result<Client, AppError> {
    let config = match storage.find(id) {
        Some(val) => val,
        None => return Err(AppError::UnknownConnection(id.to_string())),
    };
    if config.read_only {
        return Err(AppError::ReadOnly { name: config.name.clone() });
    }
    client_for(pool, storage, id).await
}

/// The two connection-facing managed states bundled behind one `State`: every
/// command that touches a live MongoDB connection takes a single
/// `ctx: State<'_, AppContext>` instead of the `pool` + `storage` pair, and
/// resolves its client/collection through the convenience methods below.
pub struct AppContext {
    pub pool: ConnectionPool,
    pub storage: Storage,
}

impl AppContext {
    /// Resolve the live client for a saved connection — the method form of
    /// `client_for`, which stays the single place the config-lookup + connect
    /// dance lives.
    pub async fn client(&self, id: &str) -> Result<Client, AppError> {
        client_for(&self.pool, &self.storage, id).await
    }

    /// The write-gated form of `client` — the method form of `client_for_write`.
    /// Mutating commands resolve their client through here so a read-only
    /// connection is refused before any write reaches the driver.
    pub async fn client_for_write(&self, id: &str) -> Result<Client, AppError> {
        client_for_write(&self.pool, &self.storage, id).await
    }

    /// Resolve straight to a collection handle for the common
    /// connection → database → collection path.
    pub async fn collection(
        &self,
        id: &str,
        database: &str,
        collection: &str,
    ) -> Result<Collection<bson::Document>, AppError> {
        let client = resolve!(self.client(id).await);
        Ok(client
            .database(database)
            .collection::<bson::Document>(collection))
    }

    /// The write-gated form of `collection`: resolves the collection handle through
    /// `client_for_write`, so a read-only connection is refused before the write.
    pub async fn collection_for_write(
        &self,
        id: &str,
        database: &str,
        collection: &str,
    ) -> Result<Collection<bson::Document>, AppError> {
        let client = resolve!(self.client_for_write(id).await);
        Ok(client
            .database(database)
            .collection::<bson::Document>(collection))
    }
}

#[derive(Serialize)]
pub struct DatabaseInfo {
    pub name: String,
    pub collections: Vec<String>,
    pub accessible: bool,
}

// macOS's system-wide "Smart Quotes" substitutes " and ' for curly equivalents
// at the OS text-input layer, before the keystroke ever reaches the web page —
// no HTML attribute on the input can suppress it. Normalize here so a query
// typed (or pasted from a rich-text source) with curly quotes still parses.
// Numeric BSON field as i64, whatever numeric type the server used. Server stats
// documents are inconsistent about Int32/Int64/Double for the same field, so every
// reader goes through this rather than matching on one type.
pub(crate) fn bson_as_i64(value: Option<&bson::Bson>) -> Option<i64> {
    match value {
        Some(bson::Bson::Int32(v)) => Some(*v as i64),
        Some(bson::Bson::Int64(v)) => Some(*v),
        Some(bson::Bson::Double(v)) => Some(*v as i64),
        _ => None,
    }
}

fn normalize_smart_quotes(value: &str) -> String {
    value
        .chars()
        .map(|c: char| match c {
            '\u{201C}' | '\u{201D}' => '"',
            '\u{2018}' | '\u{2019}' => '\'',
            other => other,
        })
        .collect()
}

// Decode a single Extended-JSON document into BSON. The frontend's query parser
// (utils/queryParser.js) emits canonical EJSON, so this is the decode end of that
// contract; it's used for filter / projection / sort / insert document / _id filter /
// index keys. `normalize_smart_quotes` stays as a cheap paste-safety backstop.
// Deserialize an Extended-JSON string into BSON, trying the input verbatim first and
// only retrying with smart quotes normalized if that first parse fails. Machine-generated
// JSON (e.g. `JSON.stringify` output from a document edit) is already valid, so it parses
// on the first attempt and its string values are left untouched — this is what stops
// `normalize_smart_quotes` from rewriting a curly quote that legitimately lives inside a
// document value (which would inject an unescaped `"` and break parsing). The normalization
// stays a cheap backstop for hand-pasted queries whose *structural* quotes are curly: those
// fail the first parse and succeed on the retry. On a genuine error the first attempt's
// message is returned so column numbers line up with the raw input.
fn parse_ejson_value(raw: &str) -> Result<bson::Bson, serde_json::Error> {
    match serde_json::from_str::<bson::Bson>(raw) {
        Ok(val) => Ok(val),
        Err(first_err) => {
            let normalized = normalize_smart_quotes(raw);
            if normalized == raw {
                return Err(first_err);
            }
            match serde_json::from_str::<bson::Bson>(&normalized) {
                Ok(val) => Ok(val),
                Err(_) => Err(first_err),
            }
        }
    }
}

pub(crate) fn parse_ejson_document(ejson: &str) -> Result<bson::Document, AppError> {
    let trimmed = ejson.trim();
    if trimmed.is_empty() || trimmed == "{}" {
        return Ok(bson::doc! {});
    }
    // Deserialize via bson::Bson so that extended-JSON types ({"$oid": "..."}, {"$date": "..."},
    // {"$numberInt": "..."}, {"$regularExpression": {...}}) decode into their BSON equivalents.
    // serde_json::Value + bson::to_document would treat {"$oid": "..."} as a plain nested
    // document, breaking _id filters.
    let bson_val: bson::Bson = match parse_ejson_value(trimmed) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Bson(format!("Invalid Extended JSON ({e})"))),
    };
    match bson_val {
        bson::Bson::Document(doc) => Ok(doc),
        _ => Err(AppError::Bson("Expected a JSON object".to_string())),
    }
}

// Parse an aggregation pipeline: a JSON array of stage objects. Mirrors parse_ejson_document's
// smart-quote and extended-JSON handling so pasted shell pipelines behave the same way.
pub(crate) fn parse_pipeline(pipeline: &str) -> Result<Vec<bson::Document>, AppError> {
    let trimmed = pipeline.trim();
    if trimmed.is_empty() || trimmed == "[]" {
        return Ok(Vec::new());
    }
    let bson_val: bson::Bson = match parse_ejson_value(trimmed) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Bson(format!(
            "Invalid pipeline JSON ({e}). Keys must be quoted, e.g. [{{\"$match\": {{\"name\": 1}}}}]"
        ))),
    };
    let array = match bson_val {
        bson::Bson::Array(val) => val,
        _ => return Err(AppError::Bson("Pipeline must be a JSON array of stages".to_string())),
    };
    let mut stages = Vec::new();
    for entry in array {
        match entry {
            bson::Bson::Document(doc) => stages.push(doc),
            _ => return Err(AppError::Bson("Each pipeline stage must be a JSON object".to_string())),
        }
    }
    Ok(stages)
}

// Parse an import file's JSON into documents: either a top-level array of objects
// or a single object. Reuses the same smart-quote / extended-JSON handling as queries.
pub(crate) fn parse_json_documents(text: &str) -> Result<Vec<bson::Document>, AppError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let bson_val: bson::Bson = match parse_ejson_value(trimmed) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Bson(format!(
            "Invalid JSON ({e}). Expected an array of documents."
        ))),
    };
    let array = match bson_val {
        bson::Bson::Array(val) => val,
        bson::Bson::Document(doc) => vec![bson::Bson::Document(doc)],
        _ => return Err(AppError::Bson("Import file must be a JSON array of documents".to_string())),
    };
    let mut docs = Vec::new();
    for entry in array {
        match entry {
            bson::Bson::Document(doc) => docs.push(doc),
            _ => return Err(AppError::Bson("Each item must be a JSON object".to_string())),
        }
    }
    Ok(docs)
}

// Quote a CSV field only when it contains a delimiter, quote, or newline, doubling
// any embedded quotes — standard RFC-4180 escaping.
fn csv_escape(value: &str) -> String {
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
    let has_next = match cursor.advance().await {
        Ok(val) => val,
        Err(e) => return Err(AppError::Mongo(e)),
    };
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
    let docs = resolve!(collect_documents(cursor).await);
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

// Streaming RFC-4180 CSV reader: yields one record (row of string fields) per call,
// reading from a `Read` incrementally so the whole file is never buffered. Handles
// quoted fields, doubled quotes, and embedded newlines exactly like the old
// whole-string reader it replaced. Operating on bytes is safe because the only
// structural characters (`"`, `,`, `\n`, `\r`) are single ASCII bytes that can never
// appear inside a multi-byte UTF-8 sequence; each field's bytes are decoded to a
// String at its boundary.
// Configurable CSV parsing options. The defaults reproduce the historical behavior
// (comma delimiter, double-quote text qualifier, first row is the header, nothing
// skipped) so every existing caller that passes `CsvOptions::default()` is unchanged;
// the import UI overrides them per file.
#[derive(Clone, Copy)]
pub(crate) struct CsvOptions {
    pub delimiter: u8,
    pub quote: u8,
    pub has_headers: bool,
    pub skip_lines: usize,
}

impl Default for CsvOptions {
    fn default() -> Self {
        CsvOptions {
            delimiter: b',',
            quote: b'"',
            has_headers: true,
            skip_lines: 0,
        }
    }
}

struct CsvRecords<R: std::io::Read> {
    bytes: std::io::Bytes<R>,
    // One-byte look-ahead buffer, used to detect a doubled quote (`""`) and to peek
    // the byte after a closing quote.
    peeked: Option<u8>,
    finished: bool,
    // The field separator and text qualifier bytes (configurable, hence compared at
    // runtime rather than matched against byte literals).
    delimiter: u8,
    quote: u8,
}

impl<R: std::io::Read> CsvRecords<R> {
    fn new(reader: R, delimiter: u8, quote: u8) -> Self {
        CsvRecords {
            bytes: reader.bytes(),
            peeked: None,
            finished: false,
            delimiter: delimiter,
            quote: quote,
        }
    }

    // Pull the next raw byte, honoring the one-byte look-ahead buffer first.
    fn next_byte(&mut self) -> Result<Option<u8>, AppError> {
        match self.peeked.take() {
            Some(byte) => Ok(Some(byte)),
            None => match self.bytes.next() {
                Some(Ok(byte)) => Ok(Some(byte)),
                Some(Err(e)) => Err(AppError::Io(e)),
                None => Ok(None),
            },
        }
    }

    // Look at the next byte without consuming it.
    fn peek_byte(&mut self) -> Result<Option<u8>, AppError> {
        if self.peeked.is_none() {
            match self.bytes.next() {
                Some(Ok(byte)) => self.peeked = Some(byte),
                Some(Err(e)) => return Err(AppError::Io(e)),
                None => return Ok(None),
            }
        }
        Ok(self.peeked)
    }

    // Decode an accumulated field's bytes into a String.
    fn field_to_string(bytes: Vec<u8>) -> Result<String, AppError> {
        match String::from_utf8(bytes) {
            Ok(value) => Ok(value),
            Err(e) => Err(AppError::Bson(format!("Import file is not valid UTF-8: {e}"))),
        }
    }

    // Read the next record, or `None` at end of input. A record ends at an unquoted
    // newline or at EOF; a trailing newline does not produce a phantom empty record
    // (the following call sees EOF with nothing buffered and returns `None`).
    fn next_record(&mut self) -> Result<Option<Vec<String>>, AppError> {
        if self.finished {
            return Ok(None);
        }
        let mut record: Vec<String> = Vec::new();
        let mut field: Vec<u8> = Vec::new();
        let mut in_quotes = false;
        loop {
            let byte = match self.next_byte() {
                Ok(Some(byte)) => byte,
                Ok(None) => {
                    // EOF: emit the final record only if there was any pending data,
                    // matching the old whole-string reader.
                    self.finished = true;
                    if !field.is_empty() || !record.is_empty() {
                        let cell = match Self::field_to_string(field) {
                            Ok(value) => value,
                            Err(e) => return Err(e),
                        };
                        record.push(cell);
                        return Ok(Some(record));
                    }
                    return Ok(None);
                }
                Err(e) => return Err(e),
            };
            if in_quotes {
                if byte == self.quote {
                    match self.peek_byte() {
                        Ok(Some(next)) if next == self.quote => {
                            // Consume the second quote of the escaped pair.
                            self.peeked = None;
                            field.push(self.quote);
                        }
                        Ok(_) => in_quotes = false,
                        Err(e) => return Err(e),
                    }
                } else {
                    field.push(byte);
                }
            } else if byte == self.quote {
                in_quotes = true;
            } else if byte == self.delimiter {
                let cell = match Self::field_to_string(std::mem::take(&mut field)) {
                    Ok(value) => value,
                    Err(e) => return Err(e),
                };
                record.push(cell);
            } else if byte == b'\n' {
                let cell = match Self::field_to_string(std::mem::take(&mut field)) {
                    Ok(value) => value,
                    Err(e) => return Err(e),
                };
                record.push(cell);
                return Ok(Some(record));
            } else if byte == b'\r' {
                // Skip carriage returns so CRLF files parse the same as LF.
            } else {
                field.push(byte);
            }
        }
    }
}

// Best-effort type coercion for a CSV cell: empty → null, true/false → bool,
// integer/float → number, everything else → string.
fn coerce_csv_value(cell: &str) -> bson::Bson {
    let trimmed = cell.trim();
    if trimmed.is_empty() {
        return bson::Bson::Null;
    }
    if trimmed == "true" {
        return bson::Bson::Boolean(true);
    }
    if trimmed == "false" {
        return bson::Bson::Boolean(false);
    }
    match trimmed.parse::<i64>() {
        Ok(val) => return bson::Bson::Int64(val),
        Err(_) => {}
    }
    match trimmed.parse::<f64>() {
        Ok(val) => return bson::Bson::Double(val),
        Err(_) => {}
    }
    bson::Bson::String(cell.to_string())
}

// A CSV data row is blank (a trailing line produced by a final newline) when every
// cell is empty; such rows are skipped rather than imported as empty documents.
fn csv_row_is_blank(row: &[String]) -> bool {
    row.iter().all(|cell| cell.is_empty())
}

// Build one document from a data row against the header row: each header becomes a
// key, a missing trailing cell becomes an empty (→ null) value, and each cell is
// type-coerced exactly as the old whole-string importer did.
fn csv_row_to_document(headers: &[String], row: &[String]) -> bson::Document {
    let mut doc = bson::Document::new();
    for (idx, header) in headers.iter().enumerate() {
        let cell = match row.get(idx) {
            Some(val) => val.as_str(),
            None => "",
        };
        doc.insert(header.clone(), coerce_csv_value(cell));
    }
    doc
}

// The importer inserts in batches of this many documents so peak memory stays O(batch)
// rather than O(file). `insert_many` per batch is ordered, so a failure in a later batch
// leaves earlier batches already committed (non-atomic on error, like `mongoimport`).
pub(crate) const IMPORT_BATCH_SIZE: usize = 1000;

// Convert one already-parsed JSON value into a document, preserving Extended-JSON
// types (`{"$oid": ...}`, `{"$date": ...}`, `{"$numberInt": ...}`, …). Routing the
// value through `serde_json::from_value::<bson::Bson>` uses bson's human-readable
// deserializer, the same decode path the whole-file `parse_json_documents` used.
fn json_value_to_document(value: serde_json::Value) -> Result<bson::Document, AppError> {
    let bson_val: bson::Bson = match serde_json::from_value(value) {
        Ok(val) => val,
        Err(e) => {
            return Err(AppError::Bson(format!(
                "Invalid JSON ({e}). Expected an array of documents."
            )))
        }
    };
    match bson_val {
        bson::Bson::Document(doc) => Ok(doc),
        _ => Err(AppError::Bson("Each item must be a JSON object".to_string())),
    }
}

// Pull a top-level JSON array (or a single top-level object, which the importer also
// accepts) element-by-element from `reader`, emitting a document per element and
// invoking `flush` with each full batch of `batch_size`, then the final partial
// batch. Uses the `struson` streaming pull-parser so nesting/escaping/whitespace are
// handled correctly without buffering the whole file. Returns the number of documents
// emitted.
fn stream_json_documents<R, F>(
    reader: R,
    batch_size: usize,
    mut flush: F,
) -> Result<usize, AppError>
where
    R: std::io::Read,
    F: FnMut(Vec<bson::Document>) -> Result<(), AppError>,
{
    use struson::reader::{JsonReader, JsonStreamReader, ValueType};

    let mut json_reader = JsonStreamReader::new(reader);
    let value_type = match json_reader.peek() {
        Ok(val) => val,
        Err(e) => {
            return Err(AppError::Bson(format!(
                "Invalid JSON ({e}). Expected an array of documents."
            )))
        }
    };
    let mut batch: Vec<bson::Document> = Vec::with_capacity(batch_size);
    let mut total: usize = 0;
    match value_type {
        ValueType::Array => {
            match json_reader.begin_array() {
                Ok(_) => {}
                Err(e) => return Err(AppError::Bson(format!("Invalid JSON ({e})"))),
            }
            loop {
                let has_next = match json_reader.has_next() {
                    Ok(val) => val,
                    Err(e) => return Err(AppError::Bson(format!("Invalid JSON ({e})"))),
                };
                if !has_next {
                    break;
                }
                let value: serde_json::Value = match json_reader.deserialize_next() {
                    Ok(val) => val,
                    Err(e) => {
                        return Err(AppError::Bson(format!(
                            "Invalid JSON ({e}). Expected an array of documents."
                        )))
                    }
                };
                let doc = match json_value_to_document(value) {
                    Ok(val) => val,
                    Err(e) => return Err(e),
                };
                batch.push(doc);
                if batch.len() >= batch_size {
                    total += batch.len();
                    match flush(std::mem::take(&mut batch)) {
                        Ok(_) => {}
                        Err(e) => return Err(e),
                    }
                }
            }
            match json_reader.end_array() {
                Ok(_) => {}
                Err(e) => return Err(AppError::Bson(format!("Invalid JSON ({e})"))),
            }
        }
        ValueType::Object => {
            let value: serde_json::Value = match json_reader.deserialize_next() {
                Ok(val) => val,
                Err(e) => {
                    return Err(AppError::Bson(format!(
                        "Invalid JSON ({e}). Expected an array of documents."
                    )))
                }
            };
            let doc = match json_value_to_document(value) {
                Ok(val) => val,
                Err(e) => return Err(e),
            };
            batch.push(doc);
        }
        _ => {
            return Err(AppError::Bson(
                "Import file must be a JSON array of documents".to_string(),
            ))
        }
    }
    if !batch.is_empty() {
        total += batch.len();
        match flush(batch) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
    }
    Ok(total)
}

// Stream a CSV file from `reader`: read the header row once, then emit a document per
// data row (blank trailing rows skipped exactly as before), invoking `flush` with each
// full batch of `batch_size` then the final partial batch. Returns the number of
// documents emitted.
fn stream_csv_documents<R, F>(
    reader: R,
    options: CsvOptions,
    batch_size: usize,
    mut flush: F,
) -> Result<usize, AppError>
where
    R: std::io::Read,
    F: FnMut(Vec<bson::Document>) -> Result<(), AppError>,
{
    let mut records = CsvRecords::new(reader, options.delimiter, options.quote);
    // Drop any leading lines (e.g. a preamble above the header row) before parsing.
    for _ in 0..options.skip_lines {
        match records.next_record() {
            Ok(Some(_)) => {}
            Ok(None) => return Ok(0),
            Err(e) => return Err(e),
        }
    }
    let mut batch: Vec<bson::Document> = Vec::with_capacity(batch_size);
    let mut total: usize = 0;
    // With a header line the first remaining record names the columns. Without one,
    // synthesize `field1..fieldN` from the first data row's width — and still import
    // that row as data rather than consuming it as a header.
    let headers = if options.has_headers {
        match records.next_record() {
            Ok(Some(row)) => row,
            Ok(None) => return Ok(0),
            Err(e) => return Err(e),
        }
    } else {
        let first = match records.next_record() {
            Ok(Some(row)) => row,
            Ok(None) => return Ok(0),
            Err(e) => return Err(e),
        };
        let synthesized: Vec<String> = (1..=first.len()).map(|i| format!("field{i}")).collect();
        if !csv_row_is_blank(&first) {
            batch.push(csv_row_to_document(&synthesized, &first));
        }
        synthesized
    };
    loop {
        let row = match records.next_record() {
            Ok(Some(row)) => row,
            Ok(None) => break,
            Err(e) => return Err(e),
        };
        if csv_row_is_blank(&row) {
            continue;
        }
        batch.push(csv_row_to_document(&headers, &row));
        if batch.len() >= batch_size {
            total += batch.len();
            match flush(std::mem::take(&mut batch)) {
                Ok(_) => {}
                Err(e) => return Err(e),
            }
        }
    }
    if !batch.is_empty() {
        total += batch.len();
        match flush(batch) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
    }
    Ok(total)
}

// Parse `reader` into batches of documents, dispatching on `format` ("csv" vs
// else = JSON) with the same semantics as the old whole-file importer. `flush` is
// called with each full batch and the final partial batch; the return value is the
// number of documents parsed. This is the pure, DB-free core shared by the import
// command and its unit tests.
fn stream_documents<R, F>(
    reader: R,
    format: &str,
    csv: CsvOptions,
    batch_size: usize,
    flush: F,
) -> Result<usize, AppError>
where
    R: std::io::Read,
    F: FnMut(Vec<bson::Document>) -> Result<(), AppError>,
{
    if format == "csv" {
        stream_csv_documents(reader, csv, batch_size, flush)
    } else {
        // JSON ignores the CSV options.
        stream_json_documents(reader, batch_size, flush)
    }
}

/// Streams an import file into `col` in bounded batches: an empty file inserts
/// nothing, otherwise documents are parsed incrementally and inserted `IMPORT_BATCH_SIZE`
/// at a time so peak memory is O(batch), not O(file). The symmetric counterpart to
/// `stream_export`. Returns the total number of documents inserted.
///
/// When `mapping` is `Some`, each parsed document is rewritten through it (rename
/// source→target, coerce per-field type, drop unmapped columns) before insertion —
/// this happens on the parse thread, so it adds no work to the async insert side.
/// `None` inserts documents exactly as parsed (the plain-import / Tasks behavior).
///
/// Parsing (sync CPU/file work) runs on a blocking thread and hands each batch to the
/// async side through a bounded channel; the channel's capacity gives back-pressure so
/// the parser can't outrun the inserts and buffer the whole file. Because each batch is
/// its own ordered `insert_many`, a failure in a later batch leaves earlier batches
/// already committed — import is non-atomic on error (matching `mongoimport`).
pub(crate) async fn stream_import(
    col: &Collection<bson::Document>,
    path: &str,
    format: &str,
    mapping: Option<Vec<portmap::FieldMap>>,
    csv: CsvOptions,
) -> Result<usize, AppError> {
    // An empty file imports nothing without touching the parser (which would reject
    // zero-length input as malformed JSON).
    let metadata = match std::fs::metadata(path) {
        Ok(val) => val,
        Err(e) => return Err(AppError::Io(e)),
    };
    if metadata.len() == 0 {
        return Ok(0);
    }

    // Capacity 1: the parser blocks on `send` once one batch is in flight, so at most
    // ~two batches are resident at any time.
    let (sender, receiver) = std::sync::mpsc::sync_channel::<Vec<bson::Document>>(1);
    let path_owned = path.to_string();
    let format_owned = format.to_string();
    let mapping_owned = mapping;
    let csv_owned = csv;
    let parse_handle = tokio::task::spawn_blocking(move || -> Result<usize, AppError> {
        let file = match std::fs::File::open(&path_owned) {
            Ok(val) => val,
            Err(e) => return Err(AppError::Io(e)),
        };
        let reader = std::io::BufReader::new(file);
        stream_documents(reader, &format_owned, csv_owned, IMPORT_BATCH_SIZE, |batch| {
            // Apply the field mapping (rename/coerce/select) before handing the
            // batch over for insertion; without a mapping the batch is inserted
            // exactly as parsed.
            let batch = match &mapping_owned {
                Some(maps) => batch
                    .into_iter()
                    .map(|doc| portmap::apply_field_map(&doc, maps))
                    .collect(),
                None => batch,
            };
            match sender.send(batch) {
                Ok(_) => Ok(()),
                // The receiver was dropped because an insert failed; stop parsing. The
                // real error is surfaced on the async side, so this message is a fallback.
                Err(_) => Err(AppError::Bson(
                    "Import aborted after an insert error".to_string(),
                )),
            }
        })
    });

    let mut total: usize = 0;
    loop {
        let batch = match receiver.recv() {
            Ok(val) => val,
            // Sender dropped: the parser finished or errored. Either way, drain done.
            Err(_) => break,
        };
        match col.insert_many(batch).await {
            Ok(result) => total += result.inserted_ids.len(),
            Err(e) => {
                // Dropping `receiver` here unblocks and stops the parser thread.
                return Err(AppError::Mongo(e));
            }
        }
    }

    // Surface a parse error (or a JoinError) now that all successfully-parsed batches
    // have been inserted.
    match parse_handle.await {
        Ok(Ok(_)) => Ok(total),
        Ok(Err(e)) => Err(e),
        Err(join_err) => Err(AppError::Bson(format!("Import task failed: {join_err}"))),
    }
}

#[cfg(test)]
mod tests;
