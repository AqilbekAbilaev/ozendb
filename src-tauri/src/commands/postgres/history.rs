//! Row-edit history for the table workspace (ozendb-h4y) — the Postgres sibling of
//! MongoDB's `commands/history.rs`, scoped to `update_pg_row` edits only (see
//! `postgres/row_history.rs`'s own doc comment for why).
use crate::error::AppError;
use crate::postgres::row_history::{PgHistoryEntry, PgRowHistoryStore};
use tauri::State;

use super::row_write::{update_row_impl, ColumnValue};
use super::AppContext;

/// Every recorded edit for one table, newest-first — backs the table workspace's
/// history panel.
#[tauri::command]
pub fn list_pg_row_history(
    history: State<'_, PgRowHistoryStore>,
    id: String,
    database: String,
    schema: String,
    table: String,
) -> Vec<PgHistoryEntry> {
    history.list_for(&id, &database, &schema, &table)
}

/// Forget all recorded edits for one table.
#[tauri::command]
pub fn clear_pg_row_history(
    history: State<'_, PgRowHistoryStore>,
    id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<(), AppError> {
    history.clear_for(&id, &database, &schema, &table)
}

/// Reverses one recorded edit: sets each changed column back to its `before`
/// value, matched on the row's primary key *and* every changed column's current
/// (`after`) value — so a row the edit itself changed again since is refused as a
/// conflict (0 rows matched) rather than silently overwritten. The entry stays in
/// history afterward, the same as MongoDB's `restore_history`.
#[tauri::command]
pub async fn undo_pg_row_edit(
    ctx: State<'_, AppContext>,
    history: State<'_, PgRowHistoryStore>,
    entry_id: String,
) -> Result<(), AppError> {
    let entry = match history.get(&entry_id) {
        Some(val) => val,
        None => return Err(AppError::Validation("That history entry no longer exists.".to_string())),
    };

    let pool = ctx.pg_pool_for_write(&entry.conn_id).await?;

    let set: Vec<ColumnValue> = entry
        .changes
        .iter()
        .map(|c| ColumnValue { column: c.column.clone(), value: c.before.clone() })
        .collect();
    let mut r#where = entry.key.clone();
    for change in &entry.changes {
        r#where.push(ColumnValue { column: change.column.clone(), value: change.after.clone() });
    }

    let affected = update_row_impl(&pool, &entry.schema, &entry.table, &set, &r#where).await?;
    if affected == 0 {
        return Err(AppError::Validation(
            "This row has changed since this edit, so undoing it was refused rather than overwriting the newer value.".to_string(),
        ));
    }
    Ok(())
}
