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

mod csv;

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
        csv::stream_csv_documents(reader, csv, batch_size, flush)
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
