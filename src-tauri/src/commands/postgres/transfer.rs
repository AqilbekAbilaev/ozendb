//! Bulk export of a table or a query's results to a file, and CSV import into a table
//! (#128). Unlike the grid,
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
use crate::commands::sql::statement::caller_sql;
use crate::commands::sql::transfer::{check_mapping, preview, write_all, DataRows, ExportResult, ExportSource, ImportColumn, ImportPreview, JsonArray, SourceKind};
use crate::error::AppError;
use futures_util::TryStreamExt;
use super::DIALECT;
use std::io::Write;
use tauri::State;

use super::AppContext;

/// The statement that streams `inner` out in `format`.
pub(crate) fn wrap_export(inner: &str, format: &str) -> Result<String, AppError> {
    match format {
        "csv" => Ok(format!("COPY ({inner}) TO STDOUT WITH (FORMAT csv, HEADER)")),
        "json" => Ok(format!("SELECT row_to_json(t)::text FROM ({inner}) t")),
        other => Err(AppError::Validation(format!("Can't export as {other}."))),
    }
}

/// A table's SELECT, its names quoted by the server: COPY takes no bind parameters.
async fn inner_sql(conn: &mut sqlx::PgConnection, source: &ExportSource) -> Result<String, AppError> {
    match source.kind()? {
        SourceKind::Query(query) => Ok(caller_sql(&DIALECT, query)?.to_string()),
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
) -> Result<ExportResult, AppError> {
    let mut bytes: u64 = 0;
    if format == "csv" {
        let mut stream = conn.copy_out_raw(statement).await.map_err(AppError::Postgres)?;
        while let Some(chunk) = stream.try_next().await.map_err(AppError::Postgres)? {
            bytes += chunk.len() as u64;
            write_all(out, &chunk)?;
        }
        return Ok(ExportResult { rows: None, bytes });
    }
    let mut array = JsonArray::default();
    let mut rows = sqlx::query_scalar::<_, String>(sqlx::AssertSqlSafe(statement.to_string())).fetch(&mut *conn);
    while let Some(json) = rows.try_next().await.map_err(AppError::Postgres)? {
        bytes += json.len() as u64;
        array.row(out, &json)?;
    }
    array.finish(out)?;
    Ok(ExportResult { rows: Some(array.rows), bytes })
}

pub(crate) async fn export_impl(
    pool: &sqlx::PgPool,
    source: &ExportSource,
    format: &str,
    path: &str,
) -> Result<ExportResult, AppError> {
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
/// `database` targets a database other than the connection's own (#124).
#[tauri::command]
pub async fn export_pg_data(
    ctx: State<'_, AppContext>,
    id: String,
    database: Option<String>,
    source: ExportSource,
    format: String,
    path: String,
) -> Result<ExportResult, AppError> {
    let pool = ctx.pg_pool_for_database(&id, database.as_deref()).await?;
    export_impl(&pool, &source, &format, &path).await
}

// ── import ──

/// One quoted CSV row for COPY. An empty field is left unquoted, which COPY reads as NULL.
pub(crate) fn encode_csv_row(fields: &[&str]) -> String {
    let cells: Vec<String> = fields
        .iter()
        .map(|f| if f.is_empty() { String::new() } else { format!("\"{}\"", f.replace('"', "\"\"")) })
        .collect();
    format!("{}\n", cells.join(","))
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

async fn import_columns(pool: &sqlx::PgPool, schema: &str, table: &str) -> Result<Vec<ImportColumn>, AppError> {
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
        .map(|(name, data_type, nullable, has_default, generated)| ImportColumn { name, data_type, nullable, has_default, generated })
        .collect())
}

pub(crate) async fn import_preview_impl(pool: &sqlx::PgPool, schema: &str, table: &str, path: &str, limit: usize) -> Result<ImportPreview, AppError> {
    preview(path, import_columns(pool, schema, table).await?, limit)
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

    let mut rows = DataRows::open(path)?;
    let mut tx = pool.begin().await.map_err(AppError::Postgres)?;
    let mut copy = tx.copy_in_raw(&statement).await.map_err(AppError::Postgres)?;
    let mut buffer: Vec<u8> = Vec::new();
    loop {
        let row = match rows.next_row() {
            Ok(Some((_, row))) => row,
            Ok(None) => break,
            Err(e) => {
                let _ = copy.abort("unreadable file").await;
                return Err(e);
            }
        };
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
) -> Result<ImportPreview, AppError> {
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
