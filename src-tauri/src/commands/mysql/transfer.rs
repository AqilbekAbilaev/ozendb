//! Bulk export of a MySQL table or a query's results to a file, and CSV import into a
//! table (#396). Unlike the grid,
//! nothing stops at ROW_RESULT_CAP: rows go to disk as they arrive. MySQL has no COPY
//! and can't write a row as JSON in column order, so every cell is read as the grid
//! reads it (cell.rs) and written here.
//!
//! Export runs on a session of its own inside a `READ ONLY` transaction, with the
//! five-minute statement limit lifted for it alone: the session is closed afterwards
//! rather than handed back to the pool, so the lifted limit ends with it.
//!
//! Import inserts the mapped fields in batches of bound values, all in one transaction:
//! sqlx's MySQL driver can't send a file for `LOAD DATA LOCAL INFILE`. An empty field is
//! NULL; the file must start with a header row, as on PostgreSQL.
use futures_util::TryStreamExt;
use serde_json::Value;
use sqlx::mysql::MySqlConnection;
use sqlx::{Column, Executor, MySqlPool, Row, SqlSafeStr, Statement, TypeInfo};
use std::io::Write;
use tauri::State;

use super::browse::base_type;
use super::cell::cell;
use super::explain::only_reads;
use super::row_write::{execute, stored, Param, MAX_PARAMS};
use super::schema::{mysql_columns, MySqlColumnInfo};
use super::{quote_name, AppContext};
use crate::commands::sql::transfer::{
    check_mapping, preview, write_all, DataRows, ExportResult, ExportSource, ImportColumn, ImportPreview, JsonArray, SourceKind,
};
use crate::error::AppError;

#[derive(Clone, Copy, PartialEq)]
enum Format {
    Csv,
    Json,
}

impl Format {
    fn of(name: &str) -> Result<Format, AppError> {
        match name {
            "csv" => Ok(Format::Csv),
            "json" => Ok(Format::Json),
            other => Err(AppError::Validation(format!("Can't export as {other}."))),
        }
    }
}

/// One CSV line, as PostgreSQL's COPY writes CSV: NULL is an empty field, an empty
/// string is `""`, and a field is quoted only when it holds a comma, quote or line break.
pub(super) fn csv_line(fields: &[Option<String>]) -> String {
    let cells: Vec<String> = fields
        .iter()
        .map(|field| match field.as_deref() {
            None => String::new(),
            Some(text) if text.is_empty() || text.contains([',', '"', '\n', '\r']) => format!("\"{}\"", text.replace('"', "\"\"")),
            Some(text) => text.to_string(),
        })
        .collect();
    format!("{}\n", cells.join(","))
}

/// A cell as CSV text: what the grid shows, except that TINYINT(1)'s true and false are
/// the 1 and 0 MySQL stores, and a JSON column's value is its JSON text, so a string in
/// it keeps its quotes. Each reads back in through import.
pub(super) fn csv_text(value: &Value, json: bool) -> Option<String> {
    match value {
        Value::Null => None,
        _ if json => Some(value.to_string()),
        Value::String(text) => Some(text.clone()),
        Value::Bool(on) => Some(String::from(if *on { "1" } else { "0" })),
        other => Some(other.to_string()),
    }
}

/// The columns' names as JSON keys. Two columns of one name, which a query can return,
/// would make one key, so JSON export refuses them rather than drop either.
pub(super) fn json_keys(names: &[&str]) -> Result<Vec<String>, AppError> {
    if let Some((_, name)) = names.iter().enumerate().find(|(at, name)| names[..*at].contains(name)) {
        return Err(AppError::Validation(format!("The query returns two columns named {name}; give them different names to export as JSON.")));
    }
    Ok(names.iter().map(|name| Value::from(*name).to_string()).collect())
}

/// A row as a JSON object with its keys in column order, which serde_json's own map,
/// sorted by key, would not keep.
pub(super) fn json_object(keys: &[String], cells: &[Value]) -> String {
    let pairs: Vec<String> = keys.iter().zip(cells).map(|(key, value)| format!("{key}:{value}")).collect();
    format!("{{{}}}", pairs.join(","))
}

/// Streams `sql`'s rows into `out`. `declared` is each column's COLUMN_TYPE for a table,
/// as the grid reads its times; empty for a query.
async fn write_rows<W: Write>(conn: &mut MySqlConnection, sql: &str, declared: &[String], format: Format, out: &mut W) -> Result<ExportResult, AppError> {
    let statement = (&mut *conn).prepare(sqlx::AssertSqlSafe(sql.to_string()).into_sql_str()).await.map_err(AppError::MySql)?;
    let names: Vec<&str> = statement.columns().iter().map(|c| c.name()).collect();
    let json_columns: Vec<bool> = statement.columns().iter().map(|c| c.type_info().name() == "JSON").collect();
    let keys = if format == Format::Json { json_keys(&names)? } else { Vec::new() };
    let mut bytes = 0u64;
    if format == Format::Csv {
        let header = csv_line(&names.iter().map(|name| Some(name.to_string())).collect::<Vec<_>>());
        bytes += header.len() as u64;
        write_all(out, header.as_bytes())?;
    }
    let (mut count, mut array) = (0u64, JsonArray::default());
    let mut rows = statement.query().fetch(&mut *conn);
    while let Some(row) = rows.try_next().await.map_err(AppError::MySql)? {
        let cells: Vec<Value> = (0..row.len())
            .map(|i| row.try_get_raw(i).map(|value| cell(value, declared.get(i).map(String::as_str))))
            .collect::<Result<_, _>>()
            .map_err(AppError::MySql)?;
        let line = match format {
            Format::Csv => csv_line(&cells.iter().zip(&json_columns).map(|(value, json)| csv_text(value, *json)).collect::<Vec<_>>()),
            Format::Json => json_object(&keys, &cells),
        };
        bytes += line.len() as u64;
        count += 1;
        match format {
            Format::Csv => write_all(out, line.as_bytes())?,
            Format::Json => array.row(out, &line)?,
        }
    }
    if format == Format::Json {
        array.finish(out)?;
    }
    Ok(ExportResult { rows: Some(count), bytes })
}

pub(crate) async fn mysql_export(pool: &MySqlPool, source: &ExportSource, format: &str, path: &str) -> Result<ExportResult, AppError> {
    let format = Format::of(format)?;
    let (sql, declared) = match source.kind()? {
        SourceKind::Table(database, table) => {
            let declared = mysql_columns(pool, database, table).await?.into_iter().map(|c| c.data_type).collect();
            (format!("SELECT * FROM {}.{}", quote_name(database)?, quote_name(table)?), declared)
        }
        SourceKind::Query(query) if only_reads(query) => (query.to_string(), Vec::new()),
        SourceKind::Query(_) => return Err(AppError::Validation(String::from("Export runs one query that only reads, such as a SELECT."))),
    };
    let mut conn = pool.acquire().await.map_err(AppError::MySql)?;
    conn.close_on_drop();
    sqlx::raw_sql("SET SESSION max_execution_time = 0; START TRANSACTION READ ONLY").execute(&mut *conn).await.map_err(AppError::MySql)?;
    let file = std::fs::File::create(path).map_err(AppError::Io)?;
    let mut out = std::io::BufWriter::new(file);
    let result = write_rows(&mut conn, &sql, &declared, format, &mut out).await;
    let _ = sqlx::raw_sql("ROLLBACK").execute(&mut *conn).await;
    let result = result?;
    out.flush().map_err(AppError::Io)?;
    Ok(result)
}

/// Export a table (`source.schema` naming its database) or a query to `path` as CSV or
/// JSON. A read, so a read-only connection may export; `database`, when given, is the
/// one a query's session starts in.
#[tauri::command]
pub async fn export_mysql_data(
    ctx: State<'_, AppContext>,
    id: String,
    database: Option<String>,
    source: ExportSource,
    format: String,
    path: String,
) -> Result<ExportResult, AppError> {
    let pool = ctx.mysql_pool(&id, database.as_deref()).await?;
    mysql_export(&pool, &source, &format, &path).await
}

// ── import ──

/// The most rows one INSERT carries: a thousand, or fewer when a thousand would bind more
/// values than the 65,535 MySQL allows a statement.
pub(super) fn batch_rows(columns: usize) -> usize {
    1000.min(MAX_PARAMS / columns.max(1))
}

/// Whether a batch of `rows` rows holding `bytes` of values is ready to send: at its row
/// limit, or at half of `max_allowed_packet`, the largest statement the server takes,
/// which leaves the other half for the statement's own text and framing.
pub(super) fn batch_full(rows: usize, bytes: usize, size: usize, max_allowed_packet: usize) -> bool {
    rows == size || bytes >= max_allowed_packet / 2
}

/// A failed INSERT's `message` naming the file's row. MySQL names a bad value's row
/// within the statement ("… at row 3"), whose `rows` began at the file's row `first`;
/// a failure it names no row for, such as a NULL in a NOT NULL column, names the batch.
pub(super) fn describe_insert_failure(message: &str, first: usize, rows: usize) -> String {
    let at_row = message.rsplit_once(" at row ").and_then(|(text, row)| Some((text, row.trim().parse::<usize>().ok()?)));
    match at_row {
        Some((text, row)) => format!("Row {}: {text}. Nothing was imported.", first + row - 1),
        None if rows == 1 => format!("Row {first}: {message}. Nothing was imported."),
        None => format!("Rows {first}–{}: {message}. Nothing was imported.", first + rows - 1),
    }
}

/// A failed batch as the user reads it, unless the server refused the statement itself
/// (SQLSTATE class 42: a privilege, say), which no row is to blame for.
fn insert_failure(e: AppError, first: usize, rows: usize) -> AppError {
    match &e {
        AppError::MySql(sqlx::Error::Database(db)) if !db.code().is_some_and(|code| code.starts_with("42")) => {
            AppError::Validation(describe_insert_failure(db.message(), first, rows))
        }
        _ => e,
    }
}

/// A CSV field as it is bound into the column `info`: empty is NULL, a JSON column takes
/// the text as JSON, and anything else is read as the grid's edits are (row_write.rs), so
/// what export wrote reads back: hex for bytes, a number for BIT, a zoned TIMESTAMP.
fn field(info: &MySqlColumnInfo, text: &str) -> Result<Param, AppError> {
    match text {
        "" => Ok(Param::Null),
        _ if base_type(&info.data_type) == "json" => Ok(Param::Text(text.to_string())),
        _ => stored(info, &Value::String(text.to_string())),
    }
}

/// The table's columns, refused for a table whose engine can't roll back: a failed
/// import there would leave the rows before it behind.
async fn import_columns(pool: &MySqlPool, database: &str, table: &str) -> Result<Vec<MySqlColumnInfo>, AppError> {
    let engine: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT t.ENGINE, e.TRANSACTIONS FROM information_schema.TABLES t \
         LEFT JOIN information_schema.ENGINES e ON e.ENGINE = t.ENGINE \
         WHERE t.TABLE_SCHEMA = ? AND t.TABLE_NAME = ?",
    )
    .bind(database)
    .bind(table)
    .fetch_optional(pool)
    .await
    .map_err(AppError::MySql)?;
    match engine {
        None => return Err(AppError::Validation(format!("There is no table {table} in database {database}."))),
        Some((None, _)) => return Err(AppError::Validation(format!("{table} in database {database} is a view; import into a table."))),
        Some((Some(engine), transactions)) if transactions.as_deref() != Some("YES") => {
            return Err(AppError::Validation(format!(
                "{table} in database {database} uses the {engine} engine, which can't roll back, so a failed import would leave part of the file behind. Convert it to InnoDB to import into it."
            )))
        }
        Some(_) => {}
    }
    mysql_columns(pool, database, table).await
}

fn shown(columns: &[MySqlColumnInfo]) -> Vec<ImportColumn> {
    columns
        .iter()
        .map(|c| ImportColumn {
            name: c.name.clone(),
            data_type: c.data_type.clone(),
            nullable: c.nullable,
            has_default: c.default.is_some() || c.auto_increment,
            generated: c.generated,
        })
        .collect()
}

pub(crate) async fn mysql_import_preview(pool: &MySqlPool, database: &str, table: &str, path: &str, limit: usize) -> Result<ImportPreview, AppError> {
    preview(path, shown(&import_columns(pool, database, table).await?), limit)
}

/// Inserts the mapped fields of every data row in batches, all in one transaction, on a
/// session of its own in strict mode, so a bad value fails rather than being stored as
/// 0 with a warning. The session is closed afterwards, so its mode ends with it.
pub(crate) async fn mysql_import_csv(pool: &MySqlPool, database: &str, table: &str, path: &str, mapping: &[Option<String>]) -> Result<u64, AppError> {
    let columns = import_columns(pool, database, table).await?;
    let pairs = check_mapping(mapping, &shown(&columns))?;
    let targets: Vec<(usize, &MySqlColumnInfo)> =
        pairs.iter().map(|(at, name)| (*at, columns.iter().find(|c| &c.name == name).expect("a column check_mapping found"))).collect();
    let names = targets.iter().map(|(_, c)| quote_name(&c.name)).collect::<Result<Vec<_>, _>>()?.join(", ");
    let into = format!("INSERT INTO {}.{} ({names}) VALUES ", quote_name(database)?, quote_name(table)?);
    let placeholders = format!("({})", vec!["?"; targets.len()].join(", "));
    let size = batch_rows(targets.len());

    let mut rows = DataRows::open(path)?;
    let mut conn = pool.acquire().await.map_err(AppError::MySql)?;
    // Closed rather than handed back, which also rolls back an import that fails.
    conn.close_on_drop();
    sqlx::raw_sql("SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',STRICT_ALL_TABLES'); START TRANSACTION")
        .execute(&mut *conn)
        .await
        .map_err(AppError::MySql)?;
    let packet: u64 = sqlx::query_scalar("SELECT @@max_allowed_packet").fetch_one(&mut *conn).await.map_err(AppError::MySql)?;
    let (mut imported, mut first, mut batch, mut bytes, mut params) = (0, 1, 0, 0, Vec::new());
    loop {
        let next = rows.next_row()?;
        if let Some((number, row)) = &next {
            if batch == 0 {
                first = *number;
            }
            for (at, info) in &targets {
                let refused = |e: AppError| AppError::Validation(format!("Row {number}: {} Nothing was imported.", e.user_message()));
                params.push(field(info, &row[*at]).map_err(refused)?);
                bytes += row[*at].len();
            }
            batch += 1;
        }
        if batch > 0 && (batch_full(batch, bytes, size, packet as usize) || next.is_none()) {
            let sql = format!("{into}{}", vec![placeholders.as_str(); batch].join(", "));
            imported += execute(&mut conn, (sql, std::mem::take(&mut params))).await.map_err(|e| insert_failure(e, first, batch))?;
            (batch, bytes) = (0, 0);
        }
        if next.is_none() {
            break;
        }
    }
    sqlx::raw_sql("COMMIT").execute(&mut *conn).await.map_err(AppError::MySql)?;
    Ok(imported)
}

/// The file's header and first rows beside the table's columns, with a first-guess
/// mapping, for the import dialog to confirm before anything is written.
#[tauri::command]
pub async fn mysql_import_preview_csv(ctx: State<'_, AppContext>, id: String, database: String, table: String, path: String) -> Result<ImportPreview, AppError> {
    mysql_import_preview(&ctx.mysql_pool(&id, None).await?, &database, &table, &path, 20).await
}

/// Import a CSV file into a table. A write: refused on a read-only connection.
#[tauri::command]
pub async fn import_mysql_csv(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    table: String,
    path: String,
    mapping: Vec<Option<String>>,
) -> Result<u64, AppError> {
    mysql_import_csv(&ctx.mysql_pool_for_write(&id, None).await?, &database, &table, &path, &mapping).await
}

#[cfg(test)]
#[path = "transfer.test.rs"]
mod tests;
