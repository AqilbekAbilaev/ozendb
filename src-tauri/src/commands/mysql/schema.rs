use crate::error::AppError;
use serde::Serialize;
use sqlparser::ast::{DataType, EnumMember};
use sqlparser::dialect::MySqlDialect;
use sqlparser::parser::Parser;
use sqlx::mysql::MySqlRow;
use sqlx::{MySqlPool, Row};
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

/// An ENUM's labels, read from its `COLUMN_TYPE`. MySQL writes them as string literals
/// with quotes doubled and backslashes escaped, whatever the session's `sql_mode`.
fn enum_values(column_type: &str) -> Option<Vec<String>> {
    let parsed = Parser::new(&MySqlDialect {}).try_with_sql(column_type).ok()?.parse_data_type().ok()?;
    let DataType::Enum(members, _) = parsed else { return None };
    Some(members.into_iter().map(|(EnumMember::Name(label) | EnumMember::NamedValue(label, _))| label).collect())
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
    /// A generated column, virtual or stored, which MySQL refuses a value for.
    pub generated: bool,
    /// An AUTO_INCREMENT column, which numbers a row inserted without a value for it.
    pub auto_increment: bool,
    /// An ENUM column's labels, in their declared order; None for any other type.
    pub enum_values: Option<Vec<String>>,
    /// The first foreign key on this column, by constraint name; None for most columns.
    pub references: Option<MySqlReference>,
}

/// One query for every table's columns: a UNION ALL branch per table, named by its place
/// in the list, since MySQL finds a table in its catalog only by equality on its name. A
/// row-constructor IN or an OR of pairs reads every table of each database instead.
fn columns_sql(tables: usize) -> String {
    // The primary key is read from its constraint rather than `COLUMN_KEY = 'PRI'`, which
    // MySQL also reports for a unique, not-null column on a table that has no primary key.
    let branch = |place: usize| {
        format!(
            r#"
        SELECT {place} AS place, c.ORDINAL_POSITION AS position, f.CONSTRAINT_NAME AS constraint_name,
            c.COLUMN_NAME AS name, c.COLUMN_TYPE AS data_type, c.IS_NULLABLE = 'YES' AS nullable,
            EXISTS (SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k
                WHERE k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME
                    AND k.COLUMN_NAME = c.COLUMN_NAME AND k.CONSTRAINT_NAME = 'PRIMARY') AS is_primary_key,
            c.COLUMN_DEFAULT AS default_value,
            -- Not DEFAULT_GENERATED, which marks a default expression such as CURRENT_TIMESTAMP.
            c.EXTRA REGEXP '(VIRTUAL|STORED) GENERATED' AS is_generated,
            c.EXTRA LIKE '%auto_increment%' AS is_auto_increment,
            f.REFERENCED_TABLE_SCHEMA AS to_database, f.REFERENCED_TABLE_NAME AS to_table, f.REFERENCED_COLUMN_NAME AS to_column
        FROM information_schema.COLUMNS c
        LEFT JOIN information_schema.KEY_COLUMN_USAGE f
            ON f.TABLE_SCHEMA = c.TABLE_SCHEMA AND f.TABLE_NAME = c.TABLE_NAME
                AND f.COLUMN_NAME = c.COLUMN_NAME AND f.REFERENCED_TABLE_NAME IS NOT NULL
        -- `SELECT *` leaves an INVISIBLE column out, and the tab lines its rows up by place.
        WHERE c.TABLE_SCHEMA = ? AND c.TABLE_NAME = ? AND c.EXTRA NOT LIKE '%INVISIBLE%'"#
        )
    };
    let branches: Vec<String> = (0..tables).map(branch).collect();
    format!("{}\n        ORDER BY place, position, constraint_name\n", branches.join("\n        UNION ALL"))
}

fn column_info(row: &MySqlRow) -> Result<MySqlColumnInfo, sqlx::Error> {
    let data_type: String = row.try_get("data_type")?;
    let references = match (row.try_get("to_database")?, row.try_get("to_table")?, row.try_get("to_column")?) {
        (Some(database), Some(table), Some(column)) => Some(MySqlReference { database, table, column }),
        _ => None,
    };
    Ok(MySqlColumnInfo {
        name: row.try_get("name")?,
        enum_values: enum_values(&data_type),
        data_type,
        nullable: row.try_get("nullable")?,
        is_primary_key: row.try_get("is_primary_key")?,
        default: row.try_get("default_value")?,
        generated: row.try_get("is_generated")?,
        auto_increment: row.try_get("is_auto_increment")?,
        references,
    })
}

/// Each of `tables`' columns, as `(database, table)`, in the order asked.
pub(crate) async fn mysql_tables_columns(pool: &MySqlPool, tables: &[(&str, &str)]) -> Result<Vec<Vec<MySqlColumnInfo>>, AppError> {
    let mut columns: Vec<Vec<MySqlColumnInfo>> = tables.iter().map(|_| Vec::new()).collect();
    if tables.is_empty() {
        return Ok(columns);
    }
    let sql = columns_sql(tables.len());
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
    for (database, table) in tables {
        query = query.bind(*database).bind(*table);
    }
    for row in query.fetch_all(pool).await.map_err(AppError::MySql)? {
        let place: i64 = row.try_get("place").map_err(AppError::MySql)?;
        let table = &mut columns[usize::try_from(place).expect("a place this query numbered")];
        let info = column_info(&row).map_err(AppError::MySql)?;
        // A column in two foreign keys comes back twice, side by side; the first one stays.
        if table.last().is_none_or(|kept| kept.name != info.name) {
            table.push(info);
        }
    }
    Ok(columns)
}

pub(crate) async fn mysql_columns(pool: &MySqlPool, database: &str, table: &str) -> Result<Vec<MySqlColumnInfo>, AppError> {
    Ok(mysql_tables_columns(pool, &[(database, table)]).await?.pop().unwrap_or_default())
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

/// One foreign key: `from_columns` hold the key, `to_columns` the columns they reference,
/// pairwise in the key's order. The table it points at may be in another database.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MySqlForeignKey {
    pub from_database: String,
    pub from_table: String,
    pub from_columns: Vec<String>,
    pub to_database: String,
    pub to_table: String,
    pub to_columns: Vec<String>,
}

/// One column of a foreign key as the catalog lists it: the key's database, table and
/// name, then the column and the one it references.
type KeyColumn = (String, String, String, String, String, String, String);

/// Catalog rows, each key's columns side by side in the key's order, as one key apiece.
fn foreign_keys(rows: Vec<KeyColumn>) -> Vec<MySqlForeignKey> {
    let mut keys: Vec<(String, MySqlForeignKey)> = Vec::new();
    for (from_database, from_table, constraint, from_column, to_database, to_table, to_column) in rows {
        match keys.last_mut() {
            Some((name, key)) if (&key.from_database, &key.from_table, &*name) == (&from_database, &from_table, &constraint) => {
                key.from_columns.push(from_column);
                key.to_columns.push(to_column);
            }
            _ => keys.push((
                constraint,
                MySqlForeignKey { from_database, from_table, from_columns: vec![from_column], to_database, to_table, to_columns: vec![to_column] },
            )),
        }
    }
    keys.into_iter().map(|(_, key)| key).collect()
}

/// The foreign keys linking `database.table` to other tables, whichever side it is on:
/// what a join from this table can follow. A branch per side, each filtered by equality,
/// since an OR across the two sides has MySQL read every key of every table. The table's
/// own keys are found by its name; the keys pointing at it through the list of foreign
/// keys, as KEY_COLUMN_USAGE has no way in by the referenced table. A key from the table
/// to itself is on both sides, and left to the first branch.
pub(crate) async fn mysql_foreign_keys(pool: &MySqlPool, database: &str, table: &str) -> Result<Vec<MySqlForeignKey>, AppError> {
    let rows: Vec<KeyColumn> = sqlx::query_as(
        r#"
        SELECT TABLE_SCHEMA, TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME,
            REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, ORDINAL_POSITION
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL
        UNION ALL
        SELECT k.TABLE_SCHEMA, k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME,
            k.REFERENCED_TABLE_SCHEMA, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, k.ORDINAL_POSITION
        FROM information_schema.REFERENTIAL_CONSTRAINTS r
        JOIN information_schema.KEY_COLUMN_USAGE k
            ON k.CONSTRAINT_SCHEMA = r.CONSTRAINT_SCHEMA AND k.TABLE_NAME = r.TABLE_NAME AND k.CONSTRAINT_NAME = r.CONSTRAINT_NAME
        WHERE r.UNIQUE_CONSTRAINT_SCHEMA = ? AND r.REFERENCED_TABLE_NAME = ?
            AND NOT (r.CONSTRAINT_SCHEMA = ? AND r.TABLE_NAME = ?)
        ORDER BY TABLE_SCHEMA, TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION
        "#,
    )
    .bind(database)
    .bind(table)
    .bind(database)
    .bind(table)
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(AppError::MySql)?;
    Ok(foreign_keys(rows))
}

#[tauri::command]
pub async fn list_mysql_foreign_keys(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    table: String,
) -> Result<Vec<MySqlForeignKey>, AppError> {
    mysql_foreign_keys(&ctx.mysql_pool(&id, None).await?, &database, &table).await
}

#[cfg(test)]
#[path = "schema.test.rs"]
mod tests;
