//! Row-edit history for MySQL's table tab, in PostgreSQL's store (`pg_row_history.json`,
//! as #397 shares `pg_queries.json`): each row a save edited, reversible by Undo. An entry
//! names the table's database in `database`; MySQL has no schema level, so `schema` is
//! empty. Recorded only for edits, not inserts or deletes, as on PostgreSQL.
use serde_json::Value;
use sqlx::mysql::MySqlConnection;
use sqlx::{MySqlPool, Row};
use tauri::State;

use super::browse::column;
use super::cell::cell;
use super::row_write::{bound, execute, found_by_key, update, MySqlRowUpdate};
use super::schema::{mysql_columns, MySqlColumnInfo};
use super::{quote_name, AppContext};
use crate::commands::postgres::ColumnValue;
use crate::error::AppError;
use crate::postgres::row_history::{PgColumnChange, PgHistoryEntry, PgRowHistoryStore};

const NO_SCHEMA: &str = "";

/// The primary key the row has once `change` is saved: an edit may give it a new one.
fn edited_key(columns: &[MySqlColumnInfo], change: &MySqlRowUpdate) -> Vec<ColumnValue> {
    columns
        .iter()
        .filter(|info| info.is_primary_key)
        .filter_map(|info| change.set.iter().chain(&change.r#where).find(|item| item.column == info.name).cloned())
        .collect()
}

/// `after` holds what the row reads back as for each of `change`'s columns, in their order.
fn entry(conn_id: &str, database: &str, table: &str, change: &MySqlRowUpdate, key: Vec<ColumnValue>, after: Vec<Value>) -> PgHistoryEntry {
    let changes = change
        .set
        .iter()
        .zip(after)
        .map(|(item, after)| PgColumnChange {
            column: item.column.clone(),
            before: change.before.iter().find(|prior| prior.column == item.column).map_or(Value::Null, |prior| prior.value.clone()),
            after,
        })
        .collect();
    PgHistoryEntry {
        id: uuid::Uuid::new_v4().to_string(),
        conn_id: conn_id.to_string(),
        database: database.to_string(),
        schema: NO_SCHEMA.to_string(),
        table: table.to_string(),
        at: chrono::Utc::now().timestamp_millis(),
        key,
        changes,
    }
}

/// The columns `names` of the row `key` finds in `table` (quoted), read as the grid reads
/// them, or `None` when no row has that key. `lock` ends the statement.
async fn read(
    connection: &mut MySqlConnection,
    table: &str,
    columns: &[MySqlColumnInfo],
    key: &[ColumnValue],
    names: &[&str],
    lock: &str,
) -> Result<Option<Vec<Value>>, AppError> {
    let (condition, params) = found_by_key(columns, key)?;
    let list = names.iter().map(|name| quote_name(name)).collect::<Result<Vec<_>, _>>()?.join(", ");
    let sql = format!("SELECT {list} FROM {table} WHERE {condition}{lock}");
    let Some(row) = bound((sql, params)).fetch_optional(&mut *connection).await.map_err(AppError::MySql)? else {
        return Ok(None);
    };
    let mut values = Vec::with_capacity(names.len());
    for (i, name) in names.iter().enumerate() {
        values.push(cell(row.try_get_raw(i).map_err(AppError::MySql)?, Some(&column(columns, name)?.data_type)));
    }
    Ok(Some(values))
}

/// The history of `change`, which `connection`'s transaction has just saved into `table`
/// (`name`, quoted): its row read back by the key it now has, so the entry holds what the
/// grid will show and what Undo checks against, not what was sent. History never fails a
/// save, so a row its new key can't find again is simply not recorded.
pub(super) async fn edit_entry(
    connection: &mut MySqlConnection,
    conn_id: &str,
    database: &str,
    name: &str,
    table: &str,
    columns: &[MySqlColumnInfo],
    change: &MySqlRowUpdate,
) -> Option<PgHistoryEntry> {
    let key = edited_key(columns, change);
    let names: Vec<&str> = key.iter().chain(&change.set).map(|item| item.column.as_str()).collect();
    let Ok(Some(mut values)) = read(connection, table, columns, &key, &names, "").await else { return None };
    let after = values.split_off(key.len());
    let key = key.into_iter().zip(values).map(|(item, value)| ColumnValue { column: item.column, value }).collect();
    Some(entry(conn_id, database, name, change, key, after))
}

/// Reverses `entry` in one transaction: its row, found by the key the edit left it with,
/// is locked and read as the grid reads it, and the undo is refused unless every changed
/// column still holds what the edit left. Compared here rather than in the UPDATE's
/// WHERE, which would misjudge JSON against text, a FLOAT, or NULL. Each column then
/// gets back its value from before, written as the grid writes it.
pub(crate) async fn mysql_undo_row_edit(pool: &MySqlPool, entry: &PgHistoryEntry) -> Result<(), AppError> {
    let columns = mysql_columns(pool, &entry.database, &entry.table).await?;
    let place = format!("table \"{}\" of database \"{}\"", entry.table, entry.database);
    let table = format!("{}.{}", quote_name(&entry.database)?, quote_name(&entry.table)?);
    let restored = MySqlRowUpdate {
        set: entry.changes.iter().map(|c| ColumnValue { column: c.column.clone(), value: c.before.clone() }).collect(),
        before: Vec::new(),
        r#where: entry.key.clone(),
    };
    let statement = update(&table, &place, &columns, &restored)?;
    let names: Vec<&str> = entry.changes.iter().map(|c| c.column.as_str()).collect();

    // Dropped uncommitted on any early return, which rolls it back.
    let mut tx = pool.begin().await.map_err(AppError::MySql)?;
    match read(&mut tx, &table, &columns, &entry.key, &names, " FOR UPDATE").await? {
        None => {
            return Err(AppError::Validation(String::from(
                "This row was deleted, or its primary key changed, since this edit, so there is nothing to undo.",
            )))
        }
        Some(now) if !now.iter().eq(entry.changes.iter().map(|c| &c.after)) => {
            return Err(AppError::Validation(String::from(
                "This row has changed since this edit, so undoing it was refused rather than overwriting the newer value.",
            )))
        }
        Some(_) => {}
    }
    execute(&mut tx, statement).await?;
    tx.commit().await.map_err(AppError::MySql)
}

/// Every recorded edit of one table, newest first.
#[tauri::command(async)]
pub fn list_mysql_row_history(history: State<'_, PgRowHistoryStore>, id: String, database: String, table: String) -> Vec<PgHistoryEntry> {
    history.list_for(&id, &database, NO_SCHEMA, &table)
}

/// Forgets every recorded edit of one table.
#[tauri::command(async)]
pub fn clear_mysql_row_history(history: State<'_, PgRowHistoryStore>, id: String, database: String, table: String) -> Result<(), AppError> {
    history.clear_for(&id, &database, NO_SCHEMA, &table)
}

/// Reverses one recorded edit (`mysql_undo_row_edit`), refused on a read-only connection.
/// The entry stays in history afterwards, as on PostgreSQL.
#[tauri::command]
pub async fn undo_mysql_row_edit(
    ctx: State<'_, AppContext>,
    history: State<'_, PgRowHistoryStore>,
    entry_id: String,
) -> Result<(), AppError> {
    let entry = history.get(&entry_id).ok_or_else(|| AppError::Validation(String::from("That history entry no longer exists.")))?;
    let pool = ctx.mysql_pool_for_write(&entry.conn_id, None).await?;
    mysql_undo_row_edit(&pool, &entry).await
}

#[cfg(test)]
#[path = "row_history.test.rs"]
mod tests;
