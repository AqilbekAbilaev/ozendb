use crate::error::AppError;
use serde::Serialize;
use sqlx::MySqlPool;
use tauri::State;

use super::AppContext;

// The catalog is read through the connection's own pool: information_schema answers
// for every database from any session, so browsing opens no pool per database.

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MySqlDatabaseInfo {
    pub name: String,
    pub system: bool,
}

// MySQL's own databases, on every server and not what a user is browsing for. Flagged
// rather than filtered, as PostgreSQL's system schemas are, so the sidebar decides.
fn is_system_database(name: &str) -> bool {
    matches!(name, "information_schema" | "mysql" | "performance_schema" | "sys")
}

/// The databases the login may see: MySQL lists only those it holds some privilege on.
pub(crate) async fn mysql_databases(pool: &MySqlPool) -> Result<Vec<MySqlDatabaseInfo>, AppError> {
    let names: Vec<String> = sqlx::query_scalar("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME")
        .fetch_all(pool)
        .await
        .map_err(AppError::MySql)?;
    Ok(names.into_iter().map(|name| MySqlDatabaseInfo { system: is_system_database(&name), name }).collect())
}

#[tauri::command]
pub async fn list_mysql_databases(ctx: State<'_, AppContext>, id: String) -> Result<Vec<MySqlDatabaseInfo>, AppError> {
    mysql_databases(&ctx.mysql_pool(&id, None).await?).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MySqlTableInfo {
    pub name: String,
    /// "table" or "view".
    pub kind: String,
    /// `TABLE_ROWS`, free to read, unlike a count. For InnoDB it is the optimizer's
    /// estimate and can be far off; None for a view.
    pub estimated_rows: Option<u64>,
}

fn table_kind(table_type: &str) -> &'static str {
    match table_type {
        "VIEW" | "SYSTEM VIEW" => "view",
        _ => "table",
    }
}

pub(crate) async fn mysql_tables(pool: &MySqlPool, database: &str) -> Result<Vec<MySqlTableInfo>, AppError> {
    let rows: Vec<(String, String, Option<u64>)> = sqlx::query_as(
        "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
    )
    .bind(database)
    .fetch_all(pool)
    .await
    .map_err(AppError::MySql)?;
    Ok(rows
        .into_iter()
        .map(|(name, table_type, rows)| {
            let kind = table_kind(&table_type);
            MySqlTableInfo { name, kind: String::from(kind), estimated_rows: rows.filter(|_| kind == "table") }
        })
        .collect())
}

#[tauri::command]
pub async fn list_mysql_tables(ctx: State<'_, AppContext>, id: String, database: String) -> Result<Vec<MySqlTableInfo>, AppError> {
    mysql_tables(&ctx.mysql_pool(&id, None).await?, &database).await
}

/// The column a foreign key points at.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MySqlReference {
    pub database: String,
    pub table: String,
    pub column: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MySqlColumnInfo {
    pub name: String,
    /// `COLUMN_TYPE` with its length and sign (`varchar(20)`, `int unsigned`,
    /// `enum('a','b')`), rather than `DATA_TYPE`'s bare `varchar`.
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub default: Option<String>,
    /// The first foreign key on this column, by constraint name; None for most columns.
    pub references: Option<MySqlReference>,
}

pub(crate) async fn mysql_columns(pool: &MySqlPool, database: &str, table: &str) -> Result<Vec<MySqlColumnInfo>, AppError> {
    // The primary key is read from its constraint rather than `COLUMN_KEY = 'PRI'`, which
    // MySQL also reports for a unique, not-null column on a table that has no primary key.
    let mut rows: Vec<(String, String, bool, bool, Option<String>, Option<String>, Option<String>, Option<String>)> = sqlx::query_as(
        r#"
        SELECT c.COLUMN_NAME, c.COLUMN_TYPE, c.IS_NULLABLE = 'YES',
            EXISTS (SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k
                WHERE k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME
                    AND k.COLUMN_NAME = c.COLUMN_NAME AND k.CONSTRAINT_NAME = 'PRIMARY'),
            c.COLUMN_DEFAULT, f.REFERENCED_TABLE_SCHEMA, f.REFERENCED_TABLE_NAME, f.REFERENCED_COLUMN_NAME
        FROM information_schema.COLUMNS c
        LEFT JOIN information_schema.KEY_COLUMN_USAGE f
            ON f.TABLE_SCHEMA = c.TABLE_SCHEMA AND f.TABLE_NAME = c.TABLE_NAME
                AND f.COLUMN_NAME = c.COLUMN_NAME AND f.REFERENCED_TABLE_NAME IS NOT NULL
        WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ?
        ORDER BY c.ORDINAL_POSITION, f.CONSTRAINT_NAME
        "#,
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(AppError::MySql)?;
    // A column in two foreign keys comes back twice, side by side; the first one stays.
    rows.dedup_by(|next, kept| next.0 == kept.0);
    Ok(rows
        .into_iter()
        .map(|(name, data_type, nullable, is_primary_key, default, to_database, to_table, to_column)| MySqlColumnInfo {
            name,
            data_type,
            nullable,
            is_primary_key,
            default,
            references: match (to_database, to_table, to_column) {
                (Some(database), Some(table), Some(column)) => Some(MySqlReference { database, table, column }),
                _ => None,
            },
        })
        .collect())
}

#[tauri::command]
pub async fn list_mysql_columns(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    table: String,
) -> Result<Vec<MySqlColumnInfo>, AppError> {
    mysql_columns(&ctx.mysql_pool(&id, None).await?, &database, &table).await
}

#[cfg(test)]
#[path = "schema.test.rs"]
mod tests;
