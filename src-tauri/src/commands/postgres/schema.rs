use crate::error::AppError;
use serde::Serialize;
use tauri::State;

use super::{primary_key_columns, AppContext};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgDatabaseInfo {
    pub name: String,
    /// Total on-disk size. None where the role may not connect: `pg_database_size`
    /// raises on those, and one unreadable database must not fail the listing.
    pub size_bytes: Option<i64>,
}

pub(crate) async fn list_databases_impl(pool: &sqlx::PgPool) -> Result<Vec<PgDatabaseInfo>, AppError> {
    let rows: Vec<(String, Option<i64>)> = match sqlx::query_as(
        "SELECT datname, \
                CASE WHEN has_database_privilege(datname, 'CONNECT') \
                     THEN pg_database_size(datname) END \
         FROM pg_database WHERE datistemplate = false ORDER BY datname",
    )
    .fetch_all(pool)
    .await
    {
        Ok(val) => val,
        Err(e) => return Err(AppError::Postgres(e)),
    };
    Ok(rows.into_iter().map(|(name, size_bytes)| PgDatabaseInfo { name, size_bytes }).collect())
}

/// Every non-template database on the server this connection points at — the
/// Postgres sibling of `list_databases`' MongoDB server-level listing. A
/// connection is bound to one database at a time (Postgres has no per-query
/// `USE`); the sidebar lists the others from here and opens a SQL tab against
/// one via `run_pg_query`'s `database` override (#124), which reuses this
/// connection's pool infrastructure (tunnel, credentials, TLS) per database.
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
    /// The planner's row estimate (`pg_class.reltuples`) — free to read, unlike a
    /// count. None for a view, or a table never vacuumed or analysed (-1 there).
    pub estimated_rows: Option<i64>,
}

pub(crate) async fn list_tables_impl(pool: &sqlx::PgPool, schema: &str) -> Result<Vec<PgTableInfo>, AppError> {
    // information_schema lists only what the role may see; pg_class adds the estimate.
    let rows: Vec<(String, String, Option<f32>)> = match sqlx::query_as(
        "SELECT t.table_name, t.table_type, c.reltuples \
         FROM information_schema.tables t \
         LEFT JOIN pg_namespace n ON n.nspname = t.table_schema \
         LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = t.table_name \
         WHERE t.table_schema = $1 ORDER BY t.table_name",
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
        .map(|(name, table_type, reltuples)| {
            let is_view = table_type == "VIEW";
            PgTableInfo {
                name,
                kind: if is_view { String::from("view") } else { String::from("table") },
                estimated_rows: reltuples.filter(|&n| !is_view && n >= 0.0).map(|n| n as i64),
            }
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
    /// An enum column's labels, in their declared order; None for any other type.
    pub enum_values: Option<Vec<String>>,
    /// `pg_attribute.attidentity`: "always" (`GENERATED ALWAYS AS IDENTITY`, INSERT
    /// must omit it or Postgres raises 428C9) or "by_default" (`GENERATED BY DEFAULT
    /// AS IDENTITY`, may be supplied or omitted); None for an ordinary column,
    /// including a plain `serial`/`DEFAULT nextval(...)` — that case is already
    /// distinguishable via `default`.
    pub identity: Option<String>,
    /// `pg_attribute.attgenerated`: "stored" for `GENERATED ALWAYS AS (expr) STORED`,
    /// which INSERT must never target at all; None otherwise. Postgres has no other
    /// `attgenerated` value today (virtual generated columns are not yet supported),
    /// but this stays a string rather than a bool for the same reason `identity` is.
    pub generated: Option<String>,
}

fn classify_identity(attidentity: &str) -> Option<String> {
    match attidentity {
        "a" => Some(String::from("always")),
        "d" => Some(String::from("by_default")),
        _ => None,
    }
}

fn classify_generated(attgenerated: &str) -> Option<String> {
    match attgenerated {
        "s" => Some(String::from("stored")),
        _ => None,
    }
}

pub(crate) async fn list_columns_impl(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
) -> Result<Vec<PgColumnInfo>, AppError> {
    let rows: Vec<(String, String, bool, Option<String>, Option<Vec<String>>, String, String)> = match sqlx::query_as(
        r#"
        SELECT
            a.attname,
            format_type(a.atttypid, a.atttypmod),
            NOT a.attnotnull,
            pg_get_expr(ad.adbin, ad.adrelid),
            (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = a.atttypid),
            a.attidentity::text,
            a.attgenerated::text
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
        .map(|(name, data_type, nullable, default, enum_values, attidentity, attgenerated)| PgColumnInfo {
            is_primary_key: pk.contains(&name),
            name,
            data_type,
            nullable,
            default,
            enum_values,
            identity: classify_identity(&attidentity),
            generated: classify_generated(&attgenerated),
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

/// One foreign key: `from_columns` hold the key, `to_columns` the columns they
/// reference, pairwise in the key's order.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PgForeignKey {
    pub from_schema: String,
    pub from_table: String,
    pub from_columns: Vec<String>,
    pub to_schema: String,
    pub to_table: String,
    pub to_columns: Vec<String>,
}

/// The foreign keys linking `schema.table` to other tables, whichever side it is
/// on — what a join from this table can follow.
pub(crate) async fn list_foreign_keys_impl(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
) -> Result<Vec<PgForeignKey>, AppError> {
    let rows: Vec<(String, String, Vec<String>, String, String, Vec<String>)> = match sqlx::query_as(
        r#"
        SELECT fns.nspname, f.relname,
            array_agg(fa.attname::text ORDER BY u.i),
            tns.nspname, t.relname,
            array_agg(ta.attname::text ORDER BY u.i)
        FROM pg_constraint k
        CROSS JOIN LATERAL unnest(k.conkey, k.confkey) WITH ORDINALITY AS u(fcol, tcol, i)
        JOIN pg_class f ON f.oid = k.conrelid
        JOIN pg_namespace fns ON fns.oid = f.relnamespace
        JOIN pg_class t ON t.oid = k.confrelid
        JOIN pg_namespace tns ON tns.oid = t.relnamespace
        JOIN pg_attribute fa ON fa.attrelid = k.conrelid AND fa.attnum = u.fcol
        JOIN pg_attribute ta ON ta.attrelid = k.confrelid AND ta.attnum = u.tcol
        WHERE k.contype = 'f'
            AND ((fns.nspname = $1 AND f.relname = $2) OR (tns.nspname = $1 AND t.relname = $2))
        GROUP BY k.oid, fns.nspname, f.relname, tns.nspname, t.relname
        ORDER BY fns.nspname, f.relname, min(fa.attname)
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
    Ok(rows
        .into_iter()
        .map(|(from_schema, from_table, from_columns, to_schema, to_table, to_columns)| PgForeignKey {
            from_schema,
            from_table,
            from_columns,
            to_schema,
            to_table,
            to_columns,
        })
        .collect())
}

#[tauri::command]
pub async fn list_pg_foreign_keys(
    ctx: State<'_, AppContext>,
    id: String,
    schema: String,
    table: String,
) -> Result<Vec<PgForeignKey>, AppError> {
    let pool = ctx.pg_pool(&id).await?;
    list_foreign_keys_impl(&pool, &schema, &table).await
}

#[cfg(test)]
#[path = "schema.test.rs"]
mod tests;

// Live-Postgres coverage of `list_databases_impl`/`list_schemas_impl`/
// `list_tables_impl`/`list_columns_impl` lives in pg_integration_tests.rs
// alongside this crate's other real-server tests, not here.
