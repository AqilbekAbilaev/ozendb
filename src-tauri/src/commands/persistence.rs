use crate::error::AppError;
use crate::history::{now_ms, HistoryStorage, QueryHistoryEntry};
use crate::default_queries::{DefaultQuery, DefaultQueryStorage};
use crate::keybindings::KeybindingStorage;
use crate::node_tags::NodeTagStorage;
use crate::saved_queries::{SavedQueryEntry, SavedQueryStorage};
use crate::tabs::TabStorage;
use crate::settings::{Settings, SettingsStorage};
use std::collections::HashMap;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub fn get_settings(settings: State<'_, SettingsStorage>) -> Settings {
    settings.load()
}

/// Persist app preferences. Each field is optional and merged over the current
/// settings, so a partial update (e.g. just toggling the theme) can't wipe the
/// others. Values are clamped/validated so a bad value can't break the UI.
#[tauri::command]
pub fn update_settings(
    settings: State<'_, SettingsStorage>,
    default_query_limit: Option<i64>,
    theme: Option<String>,
    default_result_view: Option<String>,
    restore_session: Option<bool>,
    editor_tab_width: Option<i64>,
) -> Result<Settings, AppError> {
    let current = settings.load();

    // Only known theme names are accepted; anything else falls back to dark so a
    // bad value from the frontend can't leave the UI in an undefined state.
    let merged_theme = match theme {
        Some(value) => value,
        None => current.theme,
    };
    let validated_theme = match merged_theme.as_str() {
        "light" => "light".to_string(),
        _ => "dark".to_string(),
    };

    // Result view is one of the three known modes; anything else falls back to table.
    let merged_view = match default_result_view {
        Some(value) => value,
        None => current.default_result_view,
    };
    let validated_view = match merged_view.as_str() {
        "json" => "json".to_string(),
        "tree" => "tree".to_string(),
        _ => "table".to_string(),
    };

    let merged_limit = match default_query_limit {
        Some(value) => value,
        None => current.default_query_limit,
    };
    let merged_restore = match restore_session {
        Some(value) => value,
        None => current.restore_session,
    };
    let merged_tab_width = match editor_tab_width {
        Some(value) => value,
        None => current.editor_tab_width,
    };

    let new_settings = Settings {
        default_query_limit: merged_limit.clamp(1, 1000),
        theme: validated_theme,
        default_result_view: validated_view,
        restore_session: merged_restore,
        editor_tab_width: merged_tab_width.clamp(1, 8),
    };
    match settings.save(&new_settings) {
        Ok(_) => Ok(new_settings),
        Err(e) => return Err(e),
    }
}

/// Current keyboard-shortcut bindings (menu-action id -> accelerator string).
/// Empty until the user customizes anything; the frontend layers these over its
/// built-in defaults.
#[tauri::command]
pub fn get_keybindings(keybindings: State<'_, KeybindingStorage>) -> HashMap<String, String> {
    keybindings.load()
}

/// Persist the full effective set of shortcut bindings. Blank accelerators are
/// dropped so an unbound entry can't linger as a phantom binding; the native
/// menu picks the new accelerators up on next launch.
#[tauri::command]
pub fn update_keybindings(
    keybindings: State<'_, KeybindingStorage>,
    bindings: HashMap<String, String>,
) -> Result<HashMap<String, String>, AppError> {
    let mut cleaned: HashMap<String, String> = HashMap::new();
    for (id, accel) in bindings.into_iter() {
        if accel.trim().is_empty() == false {
            cleaned.insert(id, accel);
        }
    }
    match keybindings.save(&cleaned) {
        Ok(_) => Ok(cleaned),
        Err(e) => return Err(e),
    }
}

#[tauri::command]
pub fn get_default_query(
    dq:            State<'_, DefaultQueryStorage>,
    connection_id: String,
    database:      String,
    collection:    String,
) -> Option<DefaultQuery> {
    let key = format!("{}::{}::{}", connection_id, database, collection);
    dq.get(&key)
}

#[tauri::command]
pub fn set_default_query(
    dq:            State<'_, DefaultQueryStorage>,
    connection_id: String,
    database:      String,
    collection:    String,
    mode:          String,
    filter:        String,
    sort:          String,
    projection:    String,
    skip:          i64,
    limit:         i64,
    pipeline:      String,
) -> Result<(), AppError> {
    let key = format!("{}::{}::{}", connection_id, database, collection);
    let entry = DefaultQuery {
        mode:       mode,
        filter:     filter,
        sort:       sort,
        projection: projection,
        skip:       skip,
        limit:      limit,
        pipeline:   pipeline,
    };
    match dq.set(&key, entry) {
        Ok(val) => Ok(val),
        Err(e)  => Err(e),
    }
}

#[tauri::command]
pub fn clear_default_query(
    dq:            State<'_, DefaultQueryStorage>,
    connection_id: String,
    database:      String,
    collection:    String,
) -> Result<(), AppError> {
    let key = format!("{}::{}::{}", connection_id, database, collection);
    match dq.clear(&key) {
        Ok(val) => Ok(val),
        Err(e)  => Err(e),
    }
}

#[tauri::command]
pub fn get_open_tabs(ts: State<'_, TabStorage>) -> Option<serde_json::Value> {
    ts.load()
}

#[tauri::command]
pub fn set_open_tabs(
    ts:      State<'_, TabStorage>,
    session: serde_json::Value,
) -> Result<(), AppError> {
    match ts.save(&session) {
        Ok(val) => Ok(val),
        Err(e)  => Err(e),
    }
}

/// All persisted database/collection colour tags, as a map of node key
/// ("connId/db" or "connId/db/coll") to colour name. Loaded on startup so tags
/// survive a restart. Connection-level tags are not here — they live on the
/// connection config and come back with `list_connections`.
#[tauri::command]
pub fn get_node_tags(tags: State<'_, NodeTagStorage>) -> HashMap<String, String> {
    tags.load()
}

/// Set or clear the colour tag on a database/collection tree node. The colour
/// "none" clears the tag (removes the entry) rather than storing it.
#[tauri::command]
pub fn set_node_tag(
    tags:  State<'_, NodeTagStorage>,
    key:   String,
    color: String,
) -> Result<(), AppError> {
    let result = if color == "none" {
        tags.clear(&key)
    } else {
        tags.set(&key, &color)
    };
    match result {
        Ok(val) => Ok(val),
        Err(e)  => Err(e),
    }
}

/// Clear every database/collection colour tag under `prefix` (e.g. "connId/" for
/// a whole connection, or "connId/db/" for one database's collections). Used when
/// a parent's colour changes, so its descendants drop their own tags and take the
/// parent's colour.
#[tauri::command]
pub fn clear_node_tags_under(
    tags:   State<'_, NodeTagStorage>,
    prefix: String,
) -> Result<(), AppError> {
    match tags.remove_under(&prefix) {
        Ok(val) => Ok(val),
        Err(e)  => Err(e),
    }
}

#[tauri::command]
pub fn list_saved_queries(sq: State<'_, SavedQueryStorage>) -> Vec<SavedQueryEntry> {
    sq.load()
}

#[tauri::command]
pub fn save_query(
    sq:         State<'_, SavedQueryStorage>,
    name:       String,
    mode:       String,
    filter:     String,
    sort:       String,
    projection: String,
    skip:       i64,
    limit:      i64,
    pipeline:   String,
) -> Result<String, AppError> {
    let id = Uuid::new_v4().to_string();
    let entry = SavedQueryEntry {
        id:         id.clone(),
        name:       name,
        mode:       mode,
        filter:     filter,
        sort:       sort,
        projection: projection,
        skip:       skip,
        limit:      limit,
        pipeline:   pipeline,
        saved_at:   now_ms(),
    };
    match sq.insert(entry) {
        Ok(_)  => Ok(id),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn delete_saved_query(sq: State<'_, SavedQueryStorage>, id: String) -> Result<(), AppError> {
    match sq.delete(&id) {
        Ok(val) => Ok(val),
        Err(e)  => Err(e),
    }
}

#[tauri::command]
pub fn get_query_history(
    history: State<'_, HistoryStorage>,
    connection_id: String,
    database: String,
    collection: String,
) -> Vec<QueryHistoryEntry> {
    let key = format!("{}::{}::{}", connection_id, database, collection);
    history.get(&key)
}

#[tauri::command]
pub fn push_query_history(
    history: State<'_, HistoryStorage>,
    connection_id: String,
    database: String,
    collection: String,
    mode: String,
    filter: String,
    sort: String,
    projection: String,
    skip: i64,
    limit: i64,
    pipeline: String,
) -> Result<(), AppError> {
    let key = format!("{}::{}::{}", connection_id, database, collection);
    let entry = QueryHistoryEntry {
        id: Uuid::new_v4().to_string(),
        mode: mode,
        filter: filter,
        sort: sort,
        projection: projection,
        skip: skip,
        limit: limit,
        pipeline: pipeline,
        ran_at: now_ms(),
    };
    match history.push(&key, entry) {
        Ok(val) => Ok(val),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn clear_query_history(
    history: State<'_, HistoryStorage>,
    connection_id: String,
    database: String,
    collection: String,
) -> Result<(), AppError> {
    let key = format!("{}::{}::{}", connection_id, database, collection);
    match history.clear(&key) {
        Ok(val) => Ok(val),
        Err(e) => Err(e),
    }
}
