use crate::error::AppError;
use serde::Serialize;
use tauri::State;

use super::{primary_key_columns, AppContext};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgDatabaseInfo {
    pub name: String,
}

pub(crate) async fn list_databases_impl(pool: &sqlx::PgPool) -> Result<Vec<PgDatabaseInfo>, AppError> {
    let rows: Vec<(String,)> = match sqlx::query_as(
        "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
    )
    .fetch_all(pool)
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    Ok(rows.into_iter().map(|(name,)| PgDatabaseInfo { name }).collect())
}

/// Every non-template database on the server this connection points at — the
/// Postgres sibling of `list_databases`' MongoDB server-level listing. A
/// connection is bound to one database at a time (Postgres has no per-query
/// `USE`), so browsing *into* a different one is later work; this exists so the
/// tree can at least show what else is on the server.
#[tauri::command]
pub async fn list_pg_databases(
    ctx: State<'_, AppContext>,
    id: String,
) -> Result<Vec<PgDatabaseInfo>, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    list_databases_impl(&pool).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgSchemaInfo {
    pub name: String,
    pub system: bool,
}

// Postgres's own schemas (pg_catalog, pg_toast, pg_temp_*, …) plus the SQL
// standard's information_schema — present in every database, and not something
// a user is browsing for. Flagged rather than filtered so the frontend decides
// whether to hide them, the same way `DatabaseInfo::accessible` reports rather
// than silently drops.
fn is_system_schema(name: &str) -> bool {
    name == "information_schema" || name.starts_with("pg_")
}

pub(crate) async fn list_schemas_impl(pool: &sqlx::PgPool) -> Result<Vec<PgSchemaInfo>, AppError> {
    let rows: Vec<(String,)> = match sqlx::query_as(
        "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name",
    )
    .fetch_all(pool)
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    Ok(rows
        .into_iter()
        .map(|(name,)| PgSchemaInfo { system: is_system_schema(&name), name })
        .collect())
}

#[tauri::command]
pub async fn list_pg_schemas(
    ctx: State<'_, AppContext>,
    id: String,
) -> Result<Vec<PgSchemaInfo>, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    list_schemas_impl(&pool).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgTableInfo {
    pub name: String,
    /// "table" or "view" — information_schema also reports foreign tables and a
    /// few other exotic kinds, folded into "table" here since nothing downstream
    /// treats them differently yet.
    pub kind: String,
}

pub(crate) async fn list_tables_impl(pool: &sqlx::PgPool, schema: &str) -> Result<Vec<PgTableInfo>, AppError> {
    let rows: Vec<(String, String)> = match sqlx::query_as(
        "SELECT table_name, table_type FROM information_schema.tables \
         WHERE table_schema = $1 ORDER BY table_name",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    Ok(rows
        .into_iter()
        .map(|(name, table_type)| PgTableInfo {
            name,
            kind: if table_type == "VIEW" { String::from("view") } else { String::from("table") },
        })
        .collect())
}

#[tauri::command]
pub async fn list_pg_tables(
    ctx: State<'_, AppContext>,
    id: String,
    schema: String,
) -> Result<Vec<PgTableInfo>, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    list_tables_impl(&pool, &schema).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgColumnInfo {
    pub name: String,
    /// `format_type(atttypid, atttypmod)` from `pg_attribute`/`pg_type` — a real,
    /// `::cast`-able type name including its length/precision modifier (e.g.
    /// `character(10)`, `numeric(8,2)`, `text[]`, or an enum's own type name).
    /// Not `information_schema.columns.data_type`: that view drops the modifier
    /// (`character(10)` and `character(1)` both report plain "character") and
    /// reports "ARRAY"/"USER-DEFINED" instead of a real, castable type name for
    /// arrays and enums.
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub default: Option<String>,
}

pub(crate) async fn list_columns_impl(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
) -> Result<Vec<PgColumnInfo>, AppError> {
    let rows: Vec<(String, String, bool, Option<String>)> = match sqlx::query_as(
        r#"
        SELECT
            a.attname,
            format_type(a.atttypid, a.atttypmod),
            NOT a.attnotnull,
            pg_get_expr(ad.adbin, ad.adrelid)
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
        WHERE n.nspname = $1 AND c.relname = $2
            AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum
        "#,
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };

    let pk = primary_key_columns(pool, schema, table).await?;

    Ok(rows
        .into_iter()
        .map(|(name, data_type, nullable, default)| PgColumnInfo {
            is_primary_key: pk.contains(&name),
            name,
            data_type,
            nullable,
            default,
        })
        .collect())
}

#[tauri::command]
pub async fn list_pg_columns(
    ctx: State<'_, AppContext>,
    id: String,
    schema: String,
    table: String,
) -> Result<Vec<PgColumnInfo>, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    list_columns_impl(&pool, &schema, &table).await
}

#[cfg(test)]
#[path = "schema.test.rs"]
mod tests;

// Live-Postgres coverage of `list_databases_impl`/`list_schemas_impl`/
// `list_tables_impl`/`list_columns_impl` lives in pg_integration_tests.rs
// alongside this crate's other real-server tests, not here.
