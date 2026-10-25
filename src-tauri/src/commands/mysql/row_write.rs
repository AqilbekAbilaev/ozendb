//! Saving the table tab's staged rows: its inserts, then its edits, then its deletes, in
//! one transaction inside one command. A failure, or a row deleted or given another
//! primary key since it was loaded, saves none of them, and no transaction is left open
//! between calls. Rows are found by their primary key alone, as on PostgreSQL, so a change
//! someone else made to a row's other columns is overwritten, not detected. Every value is
//! bound; only quoted names are written into the SQL.
use serde::Deserialize;
use serde_json::Value;
use sqlx::mysql::MySqlConnection;
use sqlx::MySqlPool;
use tauri::State;

use super::browse::{base_type, column, flag, typed, unzoned};
use super::schema::{mysql_columns, MySqlColumnInfo};
use super::{quote_name, AppContext};
use crate::commands::postgres::ColumnValue;
use crate::error::AppError;

/// The types the grid shows as MySQL's hex literal (commands/mysql/cell.rs), and so
/// reads back from one.
const BYTES: [&str; 15] = [
    "binary", "varbinary", "tinyblob", "blob", "mediumblob", "longblob", "geometry", "point", "linestring", "polygon",
    "multipoint", "multilinestring", "multipolygon", "geomcollection", "geometrycollection",
];

/// An edited row: the values it takes, and its primary key as the grid loaded it.
#[derive(Deserialize)]
pub struct MySqlRowUpdate {
    pub(super) set: Vec<ColumnValue>,
    pub(super) r#where: Vec<ColumnValue>,
}

/// Everything a table tab saves at once. A delete names a row by its primary key.
#[derive(Deserialize)]
pub struct MySqlRowChanges {
    inserts: Vec<Vec<ColumnValue>>,
    updates: Vec<MySqlRowUpdate>,
    deletes: Vec<Vec<ColumnValue>>,
}

/// A value as it is bound. Text is read by MySQL as the column's type, exactly for an
/// integer or DECIMAL; a BIT is bound as a number, which text would not be: MySQL reads
/// '5' into a BIT as the byte 0x35.
#[derive(Debug, PartialEq)]
pub(super) enum Param {
    Null,
    Text(String),
    Bytes(Vec<u8>),
    Number(u64),
}

pub(super) type Statement = (String, Vec<Param>);

/// The most values one prepared statement binds: MySQL counts them in 16 bits.
pub(super) const MAX_PARAMS: usize = 65_535;

/// The bytes a `0x…` hex literal, as the grid shows a binary value, spells.
fn bytes(info: &MySqlColumnInfo, value: &Value) -> Result<Vec<u8>, AppError> {
    let refused = || AppError::Validation(format!("\"{}\" holds bytes: write them in hex, like 0x4F7A.", info.name));
    let hex = value.as_str().and_then(|text| text.strip_prefix("0x").or_else(|| text.strip_prefix("0X"))).ok_or_else(refused)?;
    if hex.len() % 2 != 0 || !hex.is_ascii() {
        return Err(refused());
    }
    (0..hex.len()).step_by(2).map(|at| u8::from_str_radix(&hex[at..at + 2], 16).map_err(|_| refused())).collect()
}

fn bits(info: &MySqlColumnInfo, value: &Value) -> Result<u64, AppError> {
    let number = match value {
        Value::String(text) => text.trim().parse().ok(),
        other => other.as_u64(),
    };
    number.ok_or_else(|| AppError::Validation(format!("\"{}\" holds bits: write them as a whole number, like 5.", info.name)))
}

/// `value` as it is written into the column `info`.
pub(super) fn stored(info: &MySqlColumnInfo, value: &Value) -> Result<Param, AppError> {
    let base = base_type(&info.data_type);
    Ok(match value {
        Value::Null => Param::Null,
        _ if base == "json" => Param::Text(value.to_string()),
        _ if BYTES.contains(&base) => Param::Bytes(bytes(info, value)?),
        _ if base == "bit" => Param::Number(bits(info, value)?),
        Value::Bool(on) => Param::Text(String::from(if *on { "1" } else { "0" })),
        Value::String(text) => Param::Text(flag(&info.data_type, text).map_or_else(|| unzoned(&info.data_type, text).into_owned(), str::to_string)),
        other => Param::Text(other.to_string()),
    })
}

/// The placeholder and value that find `value` in the key column `info`, compared as a
/// filter is (browse.rs): a bare text placeholder would compare a BIGINT as a float.
pub(super) fn matched(info: &MySqlColumnInfo, value: &Value) -> Result<(String, Param), AppError> {
    if BYTES.contains(&base_type(&info.data_type)) {
        return Ok((String::from("?"), Param::Bytes(bytes(info, value)?)));
    }
    let text = match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    };
    let (text, placeholder) = typed(info, &text, "The key value for")?;
    Ok((placeholder, Param::Text(text)))
}

/// The column named `name`, refused when MySQL takes no value for it.
fn writable<'a>(columns: &'a [MySqlColumnInfo], name: &str) -> Result<&'a MySqlColumnInfo, AppError> {
    let info = column(columns, name)?;
    if info.generated {
        return Err(AppError::Validation(format!("\"{name}\" is generated, so it takes no value.")));
    }
    Ok(info)
}

/// `a = ? AND b = ?` over the table's whole primary key, from `row`'s values for it.
fn found_by_key(columns: &[MySqlColumnInfo], row: &[ColumnValue]) -> Result<(String, Vec<Param>), AppError> {
    let key: Vec<&MySqlColumnInfo> = columns.iter().filter(|c| c.is_primary_key).collect();
    if key.is_empty() {
        return Err(AppError::Validation(String::from(
            "This table has no primary key, so a row can't be found again safely to change it.",
        )));
    }
    let mut conditions = Vec::with_capacity(key.len());
    let mut params = Vec::with_capacity(key.len());
    for info in key {
        let Some(item) = row.iter().find(|item| item.column == info.name) else {
            return Err(AppError::Validation(String::from("Each row must be named by its whole primary key.")));
        };
        let (placeholder, param) = matched(info, &item.value)?;
        conditions.push(format!("{} = {placeholder}", quote_name(&info.name)?));
        params.push(param);
    }
    Ok((conditions.join(" AND "), params))
}

/// With no values, a row of the columns' defaults.
pub(super) fn insert(table: &str, columns: &[MySqlColumnInfo], values: &[ColumnValue]) -> Result<Statement, AppError> {
    let mut names = Vec::with_capacity(values.len());
    let mut params = Vec::with_capacity(values.len());
    for item in values {
        let info = writable(columns, &item.column)?;
        names.push(quote_name(&info.name)?);
        params.push(stored(info, &item.value)?);
    }
    Ok((format!("INSERT INTO {table} ({}) VALUES ({})", names.join(", "), vec!["?"; names.len()].join(", ")), params))
}

/// `place` names the table in a refusal, as `mysql_save_rows` words it.
pub(super) fn update(table: &str, place: &str, columns: &[MySqlColumnInfo], change: &MySqlRowUpdate) -> Result<Statement, AppError> {
    if change.set.is_empty() {
        return Err(AppError::Validation(format!("Nothing to update in {place}.")));
    }
    let mut assignments = Vec::with_capacity(change.set.len());
    let mut params = Vec::with_capacity(change.set.len());
    for item in &change.set {
        let info = writable(columns, &item.column)?;
        assignments.push(format!("{} = ?", quote_name(&info.name)?));
        params.push(stored(info, &item.value)?);
    }
    let (condition, key) = found_by_key(columns, &change.r#where)?;
    params.extend(key);
    Ok((format!("UPDATE {table} SET {} WHERE {condition}", assignments.join(", ")), params))
}

/// As few statements as MySQL can bind: each binds the whole key of every row it deletes,
/// and a statement binds at most `MAX_PARAMS` values.
pub(super) fn delete(table: &str, columns: &[MySqlColumnInfo], rows: &[Vec<ColumnValue>]) -> Result<Vec<Statement>, AppError> {
    let key_length = columns.iter().filter(|c| c.is_primary_key).count().max(1);
    rows.chunks(MAX_PARAMS / key_length)
        .map(|chunk| {
            let mut conditions = Vec::with_capacity(chunk.len());
            let mut params = Vec::new();
            for row in chunk {
                let (condition, key) = found_by_key(columns, row)?;
                conditions.push(format!("({condition})"));
                params.extend(key);
            }
            Ok((format!("DELETE FROM {table} WHERE {}", conditions.join(" OR ")), params))
        })
        .collect()
}

/// The rows a statement matched, edited or not: sqlx asks MySQL for found rows, not
/// changed ones, so saving a value a row already holds still counts it.
pub(super) async fn execute(connection: &mut MySqlConnection, (sql, params): Statement) -> Result<u64, AppError> {
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
    for param in params {
        query = match param {
            Param::Null => query.bind(None::<String>),
            Param::Text(text) => query.bind(text),
            Param::Bytes(bytes) => query.bind(bytes),
            Param::Number(number) => query.bind(number),
        };
    }
    Ok(query.execute(connection).await.map_err(AppError::MySql)?.rows_affected())
}

fn expect(rows: u64, expected: usize, refusal: String) -> Result<(), AppError> {
    if rows == expected as u64 { Ok(()) } else { Err(AppError::Validation(refusal)) }
}

pub(crate) async fn mysql_save_rows(pool: &MySqlPool, database: &str, table: &str, changes: &MySqlRowChanges) -> Result<(), AppError> {
    let columns = mysql_columns(pool, database, table).await?;
    let place = format!("table \"{table}\" of database \"{database}\"");
    let table = format!("{}.{}", quote_name(database)?, quote_name(table)?);
    // Every statement is built before the transaction begins, so a refused value opens none.
    let inserts: Vec<Statement> = changes.inserts.iter().map(|row| insert(&table, &columns, row)).collect::<Result<_, _>>()?;
    let updates: Vec<Statement> = changes.updates.iter().map(|change| update(&table, &place, &columns, change)).collect::<Result<_, _>>()?;
    let deletes = delete(&table, &columns, &changes.deletes)?;

    // Dropped uncommitted on any early return, which rolls it back.
    let mut tx = pool.begin().await.map_err(AppError::MySql)?;
    for statement in inserts {
        expect(execute(&mut tx, statement).await?, 1, format!("An insert into {place} failed unexpectedly."))?;
    }
    for statement in updates {
        let refusal = format!("A row in {place} was deleted, or its primary key changed, since it was loaded.");
        expect(execute(&mut tx, statement).await?, 1, refusal)?;
    }
    let mut deleted = 0;
    for statement in deletes {
        deleted += execute(&mut tx, statement).await?;
    }
    let refusal = format!("Some rows in {place} were already deleted, or their primary key changed, since they were loaded.");
    expect(deleted, changes.deletes.len(), refusal)?;
    tx.commit().await.map_err(AppError::MySql)
}

/// Saves a table tab's staged rows (see the note at the top). A read-only connection is
/// refused here, and by the server for any SQL (mysql/session.rs).
// TODO #417: record each edit's row history, as
// update_pg_row does, from the `before` values the tab sends with every update.
#[tauri::command]
pub async fn save_mysql_rows(
    ctx: State<'_, AppContext>,
    id: String,
    database: String,
    table: String,
    changes: MySqlRowChanges,
) -> Result<(), AppError> {
    let pool = ctx.mysql_pool_for_write(&id, None).await?;
    mysql_save_rows(&pool, &database, &table, &changes).await
}

#[cfg(test)]
#[path = "row_write.test.rs"]
mod tests;
