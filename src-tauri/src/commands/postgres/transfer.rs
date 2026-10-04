//! Bulk export of a table or a query's results to a file (ozendb-6v3). Unlike the grid,
//! nothing stops at ROW_RESULT_CAP: rows go to disk as they arrive. CSV is Postgres's
//! own `COPY … TO STDOUT`, so quoting and value formatting are the server's; JSON
//! writes each row's `row_to_json` text untouched, keeping column order and types.
//!
//! Export is a read whatever the connection allows, so it always runs inside a
//! `READ ONLY` transaction: a query like `COPY (DELETE … RETURNING *)` is refused there.
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

#[cfg(test)]
#[path = "transfer.test.rs"]
mod tests;
