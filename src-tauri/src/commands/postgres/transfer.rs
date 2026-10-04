//! Bulk export of a table or a query's results to a file, and CSV import into a table
//! (ozendb-6v3). Unlike the grid,
//! nothing stops at ROW_RESULT_CAP: rows go to disk as they arrive. CSV is Postgres's
//! own `COPY … TO STDOUT`, so quoting and value formatting are the server's; JSON
//! writes each row's `row_to_json` text untouched, keeping column order and types.
//!
//! Export is a read whatever the connection allows, so it always runs inside a
//! `READ ONLY` transaction: a query like `COPY (DELETE … RETURNING *)` is refused there.
//!
//! Import maps CSV columns onto table columns, then streams the mapped fields through
//! `COPY … FROM STDIN` in one transaction: Postgres parses each value as its column's
//! type, and the first bad row rolls the whole import back, named by row and column.
//! An empty field is NULL; the file must start with a header row.
use crate::error::AppError;
use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use std::io::Write;
use tauri::State;

use super::AppContext;

/// What to export: a whole table, or the rows of a query.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PgExportSource {
    pub schema: Option<String>,
    pub table: Option<String>,
    pub query: Option<String>,
}

pub(crate) enum SourceKind<'a> {
    Table(&'a str, &'a str),
    Query(&'a str),
}

impl PgExportSource {
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
pub struct PgExportResult {
    /// Counted for JSON. CSV comes back from COPY as bytes, and a value may hold a
    /// newline, so its row count isn't known without parsing it.
    pub rows: Option<u64>,
    pub bytes: u64,
}

/// The statement that streams `inner` out in `format`.
pub(crate) fn wrap_export(inner: &str, format: &str) -> Result<String, AppError> {
    match format {
        "csv" => Ok(format!("COPY ({inner}) TO STDOUT WITH (FORMAT csv, HEADER)")),
        "json" => Ok(format!("SELECT row_to_json(t)::text FROM ({inner}) t")),
        other => Err(AppError::Validation(format!("Can't export as {other}."))),
    }
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

fn write_all<W: Write>(out: &mut W, bytes: &[u8]) -> Result<(), AppError> {
    out.write_all(bytes).map_err(AppError::Io)
}

/// A table's SELECT, its names quoted by the server: COPY takes no bind parameters.
async fn inner_sql(conn: &mut sqlx::PgConnection, source: &PgExportSource) -> Result<String, AppError> {
    match source.kind()? {
        SourceKind::Query(query) => Ok(super::statement::caller_sql(query)?.to_string()),
        SourceKind::Table(schema, table) => sqlx::query_scalar("SELECT format('SELECT * FROM %I.%I', $1, $2)")
            .bind(schema)
            .bind(table)
            .fetch_one(conn)
            .await
            .map_err(AppError::Postgres),
    }
}

async fn stream_to<W: Write>(
    conn: &mut sqlx::PgConnection,
    statement: &str,
    format: &str,
    out: &mut W,
) -> Result<PgExportResult, AppError> {
    let mut bytes: u64 = 0;
    if format == "csv" {
        let mut stream = conn.copy_out_raw(statement).await.map_err(AppError::Postgres)?;
        while let Some(chunk) = stream.try_next().await.map_err(AppError::Postgres)? {
            bytes += chunk.len() as u64;
            write_all(out, &chunk)?;
        }
        return Ok(PgExportResult { rows: None, bytes });
    }
    let mut array = JsonArray::default();
    let mut rows = sqlx::query_scalar::<_, String>(sqlx::AssertSqlSafe(statement.to_string())).fetch(&mut *conn);
    while let Some(json) = rows.try_next().await.map_err(AppError::Postgres)? {
        bytes += json.len() as u64;
        array.row(out, &json)?;
    }
    array.finish(out)?;
    Ok(PgExportResult { rows: Some(array.rows), bytes })
}

pub(crate) async fn export_impl(
    pool: &sqlx::PgPool,
    source: &PgExportSource,
    format: &str,
    path: &str,
) -> Result<PgExportResult, AppError> {
    let mut tx = pool.begin().await.map_err(AppError::Postgres)?;
    sqlx::query("SET TRANSACTION READ ONLY").execute(&mut *tx).await.map_err(AppError::Postgres)?;
    let statement = wrap_export(&inner_sql(&mut tx, source).await?, format)?;
    let file = std::fs::File::create(path).map_err(AppError::Io)?;
    let mut out = std::io::BufWriter::new(file);
    let result = stream_to(&mut tx, &statement, format, &mut out).await;
    let _ = tx.rollback().await;
    let result = result?;
    out.flush().map_err(AppError::Io)?;
    Ok(result)
}

/// Export a table or a query to `path` as CSV or JSON. A read, so it uses `pg_pool`;
/// `database` targets a database other than the connection's own (ozendb-bj2).
#[tauri::command]
pub async fn export_pg_data(
    ctx: State<'_, AppContext>,
    id: String,
    database: Option<String>,
    source: PgExportSource,
    format: String,
    path: String,
) -> Result<PgExportResult, AppError> {
    let pool = ctx.pg_pool_for_database(&id, database.as_deref()).await?;
    export_impl(&pool, &source, &format, &path).await
}

// ── import ──

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PgImportColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub has_default: bool,
    /// A generated column computes its own value, so nothing may be imported into it.
    pub generated: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PgImportPreview {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub columns: Vec<PgImportColumn>,
    /// A first guess per header: the same-named column, if there is one.
    pub mapping: Vec<Option<String>>,
}

/// One quoted CSV row for COPY. An empty field is left unquoted, which COPY reads as NULL.
pub(crate) fn encode_csv_row(fields: &[&str]) -> String {
    let cells: Vec<String> = fields
        .iter()
        .map(|f| if f.is_empty() { String::new() } else { format!("\"{}\"", f.replace('"', "\"\"")) })
        .collect();
    format!("{}\n", cells.join(","))
}

pub(crate) fn auto_mapping(headers: &[String], columns: &[PgImportColumn]) -> Vec<Option<String>> {
    headers
        .iter()
        .map(|h| columns.iter().find(|c| !c.generated && c.name.eq_ignore_ascii_case(h.trim())).map(|c| c.name.clone()))
        .collect()
}

/// `mapping` holds a target column per CSV header (None skips it); returns the mapped
/// (header index, column) pairs in header order.
pub(crate) fn check_mapping(mapping: &[Option<String>], columns: &[PgImportColumn]) -> Result<Vec<(usize, String)>, AppError> {
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

/// COPY's error context reads like `COPY items, line 3, column price: "abc"`; the line
/// counts the rows sent, which are the file's data rows in order.
pub(crate) fn describe_copy_failure(message: &str, context: Option<&str>) -> String {
    let context = context.unwrap_or("");
    let line = context.split(", ").find_map(|part| part.strip_prefix("line ")).map(|rest| rest.split(':').next().unwrap_or(rest));
    let column = context.split(", column ").nth(1).map(|rest| rest.split(':').next().unwrap_or(rest));
    match (line, column) {
        (Some(line), Some(column)) => format!("Row {line} (column {column}): {message}. Nothing was imported."),
        (Some(line), None) => format!("Row {line}: {message}. Nothing was imported."),
        _ => format!("{message}. Nothing was imported."),
    }
}

fn copy_failure(e: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &e {
        if let Some(pg) = db.try_downcast_ref::<sqlx::postgres::PgDatabaseError>() {
            if pg.r#where().is_some_and(|w| w.starts_with("COPY ")) {
                return AppError::Validation(describe_copy_failure(pg.message(), pg.r#where()));
            }
        }
    }
    AppError::Postgres(e)
}

async fn import_columns(pool: &sqlx::PgPool, schema: &str, table: &str) -> Result<Vec<PgImportColumn>, AppError> {
    let rows: Vec<(String, String, bool, bool, bool)> = sqlx::query_as(
        "SELECT a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull, \
                a.atthasdef OR a.attidentity <> '', a.attgenerated <> '' \
         FROM pg_attribute a \
         JOIN pg_class c ON c.oid = a.attrelid \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped \
         ORDER BY a.attnum",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(AppError::Postgres)?;
    if rows.is_empty() {
        return Err(AppError::Validation(format!("There is no table {schema}.{table}.")));
    }
    Ok(rows
        .into_iter()
        .map(|(name, data_type, nullable, has_default, generated)| PgImportColumn { name, data_type, nullable, has_default, generated })
        .collect())
}

fn open_csv(path: &str) -> Result<crate::commands::import::CsvRecords<std::io::BufReader<std::fs::File>>, AppError> {
    let file = std::fs::File::open(path).map_err(AppError::Io)?;
    Ok(crate::commands::import::CsvRecords::new(std::io::BufReader::new(file), b',', b'"'))
}

pub(crate) async fn import_preview_impl(pool: &sqlx::PgPool, schema: &str, table: &str, path: &str, limit: usize) -> Result<PgImportPreview, AppError> {
    let columns = import_columns(pool, schema, table).await?;
    let mut records = open_csv(path)?;
    let headers = match records.next_record()? {
        Some(val) => val,
        None => return Err(AppError::Validation(String::from("The file is empty."))),
    };
    let mut rows = Vec::new();
    while rows.len() < limit {
        match records.next_record()? {
            Some(row) => rows.push(row),
            None => break,
        }
    }
    let mapping = auto_mapping(&headers, &columns);
    Ok(PgImportPreview { headers, rows, columns, mapping })
}

/// Streams the mapped fields of every data row into COPY, all in one transaction.
pub(crate) async fn import_csv_impl(pool: &sqlx::PgPool, schema: &str, table: &str, path: &str, mapping: &[Option<String>]) -> Result<u64, AppError> {
    let columns = import_columns(pool, schema, table).await?;
    let pairs = check_mapping(mapping, &columns)?;
    let targets: Vec<&str> = pairs.iter().map(|(_, c)| c.as_str()).collect();
    let statement: String = sqlx::query_scalar(
        "SELECT format('COPY %I.%I (%s) FROM STDIN WITH (FORMAT csv)', $1, $2, \
                (SELECT string_agg(quote_ident(c), ', ' ORDER BY i) FROM unnest($3::text[]) WITH ORDINALITY u(c, i)))",
    )
    .bind(schema)
    .bind(table)
    .bind(&targets)
    .fetch_one(pool)
    .await
    .map_err(AppError::Postgres)?;

    let mut records = open_csv(path)?;
    let width = match records.next_record()? {
        Some(headers) => headers.len(),
        None => return Err(AppError::Validation(String::from("The file is empty."))),
    };
    let mut tx = pool.begin().await.map_err(AppError::Postgres)?;
    let mut copy = tx.copy_in_raw(&statement).await.map_err(AppError::Postgres)?;
    let mut buffer: Vec<u8> = Vec::new();
    let mut row_number = 0usize;
    loop {
        let row = match records.next_record() {
            Ok(Some(row)) => row,
            Ok(None) => break,
            Err(e) => {
                let _ = copy.abort("unreadable file").await;
                return Err(e);
            }
        };
        if row.iter().all(|f| f.trim().is_empty()) {
            continue;
        }
        row_number += 1;
        if row.len() != width {
            let _ = copy.abort("ragged row").await;
            return Err(AppError::Validation(format!(
                "Row {row_number} has {} fields; the header has {width}. Nothing was imported.",
                row.len()
            )));
        }
        let fields: Vec<&str> = pairs.iter().map(|(i, _)| row[*i].as_str()).collect();
        buffer.extend_from_slice(encode_csv_row(&fields).as_bytes());
        if buffer.len() >= 64 * 1024 {
            copy.send(std::mem::take(&mut buffer)).await.map_err(copy_failure)?;
        }
    }
    if !buffer.is_empty() {
        copy.send(buffer).await.map_err(copy_failure)?;
    }
    let rows = copy.finish().await.map_err(copy_failure)?;
    tx.commit().await.map_err(AppError::Postgres)?;
    Ok(rows)
}

/// The file's header and first rows beside the table's columns, with a first-guess
/// mapping, for the import dialog to confirm before anything is written.
#[tauri::command]
pub async fn pg_import_preview(
    ctx: State<'_, AppContext>,
    id: String,
    database: Option<String>,
    schema: String,
    table: String,
    path: String,
) -> Result<PgImportPreview, AppError> {
    let pool = ctx.pg_pool_for_database(&id, database.as_deref()).await?;
    import_preview_impl(&pool, &schema, &table, &path, 20).await
}

/// Import a CSV file into a table. A write: refused on a read-only connection.
#[tauri::command]
pub async fn import_pg_csv(
    ctx: State<'_, AppContext>,
    id: String,
    database: Option<String>,
    schema: String,
    table: String,
    path: String,
    mapping: Vec<Option<String>>,
) -> Result<u64, AppError> {
    let pool = ctx.pg_pool_for_write_for_database(&id, database.as_deref()).await?;
    import_csv_impl(&pool, &schema, &table, &path, &mapping).await
}

#[cfg(test)]
#[path = "transfer.test.rs"]
mod tests;
