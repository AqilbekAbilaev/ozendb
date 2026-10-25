//! What every SQL engine's bulk export and CSV import share and that never talks to a
//! server (#128): what an export reads from, the JSON array it writes, and how a CSV
//! file's columns map onto a table's. Each engine's `transfer.rs` does the talking.
use crate::commands::import::CsvRecords;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::io::{BufReader, Write};

/// What to export: a whole table, or the rows of a query. `schema` is the namespace the
/// table sits in, a MySQL table's database, as the shared table tab names it.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportSource {
    pub schema: Option<String>,
    pub table: Option<String>,
    pub query: Option<String>,
}

pub(crate) enum SourceKind<'a> {
    Table(&'a str, &'a str),
    Query(&'a str),
}

impl ExportSource {
    pub(crate) fn kind(&self) -> Result<SourceKind<'_>, AppError> {
        let query = self.query.as_deref().map(|q| q.trim().trim_end_matches(';').trim()).filter(|q| !q.is_empty());
        match (self.schema.as_deref(), self.table.as_deref(), query) {
            (Some(schema), Some(table), None) => Ok(SourceKind::Table(schema, table)),
            (None, None, Some(query)) => Ok(SourceKind::Query(query)),
            _ => Err(AppError::Validation(String::from("Export a table or a query, not both."))),
        }
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    /// None when the engine can't count them: PostgreSQL's CSV comes back from COPY as
    /// bytes, and a value may hold a newline, so its row count isn't known without parsing it.
    pub rows: Option<u64>,
    pub bytes: u64,
}

/// Writes a JSON array one element at a time, so a large export never sits in memory.
#[derive(Default)]
pub(crate) struct JsonArray {
    pub rows: u64,
}

impl JsonArray {
    pub(crate) fn row<W: Write>(&mut self, out: &mut W, json: &str) -> Result<(), AppError> {
        let prefix = if self.rows == 0 { "[\n  " } else { ",\n  " };
        self.rows += 1;
        write_all(out, prefix.as_bytes())?;
        write_all(out, json.as_bytes())
    }

    pub(crate) fn finish<W: Write>(&self, out: &mut W) -> Result<(), AppError> {
        write_all(out, if self.rows == 0 { b"[]\n" } else { b"\n]\n" })
    }
}

pub(crate) fn write_all<W: Write>(out: &mut W, bytes: &[u8]) -> Result<(), AppError> {
    out.write_all(bytes).map_err(AppError::Io)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub has_default: bool,
    /// A generated column computes its own value, so nothing may be imported into it.
    pub generated: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub columns: Vec<ImportColumn>,
    /// A first guess per header: the same-named column, if there is one.
    pub mapping: Vec<Option<String>>,
}

pub(crate) fn auto_mapping(headers: &[String], columns: &[ImportColumn]) -> Vec<Option<String>> {
    headers
        .iter()
        .map(|h| columns.iter().find(|c| !c.generated && c.name.eq_ignore_ascii_case(h.trim())).map(|c| c.name.clone()))
        .collect()
}

/// `mapping` holds a target column per CSV header (None skips it); returns the mapped
/// (header index, column) pairs in header order.
pub(crate) fn check_mapping(mapping: &[Option<String>], columns: &[ImportColumn]) -> Result<Vec<(usize, String)>, AppError> {
    let mut pairs: Vec<(usize, String)> = Vec::new();
    for (index, target) in mapping.iter().enumerate() {
        let Some(target) = target else { continue };
        match columns.iter().find(|c| &c.name == target) {
            None => return Err(AppError::Validation(format!("The table has no column {target}."))),
            Some(c) if c.generated => return Err(AppError::Validation(format!("{target} is generated and can't be imported into."))),
            Some(_) => {}
        }
        if pairs.iter().any(|(_, c)| c == target) {
            return Err(AppError::Validation(format!("{target} is mapped from two CSV columns.")));
        }
        pairs.push((index, target.clone()));
    }
    if pairs.is_empty() {
        return Err(AppError::Validation(String::from("Map at least one CSV column to a table column.")));
    }
    Ok(pairs)
}

pub(crate) type CsvFile = CsvRecords<BufReader<std::fs::File>>;

/// The CSV file at `path` and its header row, which every import file must start with.
pub(crate) fn open_csv(path: &str) -> Result<(CsvFile, Vec<String>), AppError> {
    let file = std::fs::File::open(path).map_err(AppError::Io)?;
    let mut records = CsvRecords::new(BufReader::new(file), b',', b'"');
    match records.next_record()? {
        Some(headers) => Ok((records, headers)),
        None => Err(AppError::Validation(String::from("The file is empty."))),
    }
}

/// A CSV file's data rows after its header, numbered from 1 as the user counts them:
/// blank lines are skipped and not counted, and a row with more or fewer fields than
/// the header is refused by its number.
pub(crate) struct DataRows {
    records: CsvFile,
    width: usize,
    number: usize,
}

impl DataRows {
    pub(crate) fn open(path: &str) -> Result<DataRows, AppError> {
        let (records, headers) = open_csv(path)?;
        Ok(DataRows { records, width: headers.len(), number: 0 })
    }

    /// The next row and its number, or None at the end of the file.
    pub(crate) fn next_row(&mut self) -> Result<Option<(usize, Vec<String>)>, AppError> {
        loop {
            let Some(row) = self.records.next_record()? else { return Ok(None) };
            if row.iter().all(|f| f.trim().is_empty()) {
                continue;
            }
            self.number += 1;
            if row.len() != self.width {
                return Err(AppError::Validation(format!(
                    "Row {} has {} fields; the header has {}. Nothing was imported.",
                    self.number,
                    row.len(),
                    self.width
                )));
            }
            return Ok(Some((self.number, row)));
        }
    }
}

/// The file's header and first `limit` rows beside the table's `columns`, with a
/// first-guess mapping, for the import dialog to confirm before anything is written.
pub(crate) fn preview(path: &str, columns: Vec<ImportColumn>, limit: usize) -> Result<ImportPreview, AppError> {
    let (mut records, headers) = open_csv(path)?;
    let mut rows = Vec::new();
    while rows.len() < limit {
        match records.next_record()? {
            Some(row) => rows.push(row),
            None => break,
        }
    }
    let mapping = auto_mapping(&headers, &columns);
    Ok(ImportPreview { headers, rows, columns, mapping })
}

#[cfg(test)]
#[path = "transfer.test.rs"]
mod tests;
