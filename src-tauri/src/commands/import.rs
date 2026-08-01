use crate::error::AppError;
use mongodb::bson;
use mongodb::Collection;

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
pub(crate) fn stream_documents<R, F>(
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
    mapping: Option<Vec<super::portmap::FieldMap>>,
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
                    .map(|doc| super::portmap::apply_field_map(&doc, maps))
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
