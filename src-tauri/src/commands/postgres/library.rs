use crate::error::AppError;
use crate::pg_query_library::{PgQueryLibraryStore, SavedSql, SqlHistoryEntry};
use crate::time::now_ms;
use tauri::State;

#[tauri::command(async)]
pub fn list_pg_history(store: State<'_, PgQueryLibraryStore>, connection_id: String) -> Vec<SqlHistoryEntry> {
    store.history(&connection_id)
}

#[tauri::command(async)]
pub fn push_pg_history(store: State<'_, PgQueryLibraryStore>, connection_id: String, sql: String) -> Result<(), AppError> {
    store.push_history(&connection_id, &sql, &now_ms())
}

#[tauri::command(async)]
pub fn clear_pg_history(store: State<'_, PgQueryLibraryStore>, connection_id: String) -> Result<(), AppError> {
    store.clear_history(&connection_id)
}

#[tauri::command(async)]
pub fn list_pg_saved(store: State<'_, PgQueryLibraryStore>, connection_id: String) -> Vec<SavedSql> {
    store.saved(&connection_id)
}

#[tauri::command(async)]
pub fn save_pg_query(
    store: State<'_, PgQueryLibraryStore>,
    connection_id: String,
    name: String,
    sql: String,
) -> Result<(), AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("Give the query a name.".to_string()));
    }
    store.save(&uuid::Uuid::new_v4().to_string(), name, &connection_id, sql.trim(), &now_ms())
}

#[tauri::command(async)]
pub fn delete_pg_saved(store: State<'_, PgQueryLibraryStore>, id: String) -> Result<(), AppError> {
    store.delete_saved(&id)
}
