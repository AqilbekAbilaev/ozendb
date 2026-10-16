use crate::error::AppError;
use crate::history::{HistoryStorage, QueryHistoryEntry};
use crate::time::now_ms;
use crate::default_queries::{DefaultQuery, DefaultQueryStorage};
use crate::keybindings::KeybindingStorage;
use crate::node_tags::NodeTagStorage;
use crate::record::Stamp;
use crate::saved_queries::{SavedQueryEntry, SavedQueryStorage};
use crate::tabs::TabStorage;
use crate::settings::{Settings, SettingsStorage};
use std::collections::HashMap;
use crate::events::THEME_CHANGED;
use crate::window_theme::window_theme;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

#[tauri::command(async)]
pub fn get_settings(settings: State<'_, SettingsStorage>) -> Settings {
    settings.settings()
}

/// Persist app preferences. Each field is optional and merged over the current
/// settings, so a partial update (e.g. just toggling the theme) can't wipe the
/// others. Values are clamped/validated so a bad value can't break the UI.
#[tauri::command(async)]
pub fn update_settings(
    app: AppHandle,
    settings: State<'_, SettingsStorage>,
    default_query_limit: Option<i64>,
    theme: Option<String>,
    default_result_view: Option<String>,
    restore_session: Option<bool>,
    editor_tab_width: Option<i64>,
    ui_zoom: Option<f64>,
) -> Result<Settings, AppError> {
    // Each change applies to the settings as stored when the store's lock is held, so
    // a sync that wrote meanwhile isn't undone.
    let (before, after) = settings.update(|current| Settings {
        default_query_limit: default_query_limit.unwrap_or(current.default_query_limit).clamp(1, 1000),
        // Only known theme names are accepted; anything else falls back to dark so a
        // bad value from the frontend can't leave the UI in an undefined state.
        theme: match theme.as_deref().unwrap_or(&current.theme) {
            "light" => String::from("light"),
            _ => String::from("dark"),
        },
        // Result view is one of the three known modes; anything else falls back to table.
        default_result_view: match default_result_view.as_deref().unwrap_or(&current.default_result_view) {
            "json" => String::from("json"),
            "tree" => String::from("tree"),
            _ => String::from("table"),
        },
        restore_session: restore_session.unwrap_or(current.restore_session),
        editor_tab_width: editor_tab_width.unwrap_or(current.editor_tab_width).clamp(1, 8),
        // The frontend snaps to its zoom ladder; clamping here too keeps a hand-edited
        // settings.json (or a NaN) from shrinking the UI to nothing on next launch.
        ui_zoom: ui_zoom.filter(|zoom| zoom.is_finite()).unwrap_or(current.ui_zoom).clamp(0.5, 2.0),
    })?;
    // The open document windows repaint from the event; the app call re-themes
    // every window's title bar.
    if after.theme != before.theme {
        app.set_theme(Some(window_theme(&after.theme)));
        app.emit(THEME_CHANGED, &after.theme).ok();
    }
    Ok(after)
}

/// Current keyboard-shortcut bindings (menu-action id -> accelerator string).
/// Empty until the user customizes anything; the frontend layers these over its
/// built-in defaults.
#[tauri::command(async)]
pub fn get_keybindings(keybindings: State<'_, KeybindingStorage>) -> HashMap<String, String> {
    keybindings.load()
}

/// Persist the full effective set of shortcut bindings. Blank accelerators are
/// dropped so an unbound entry can't linger as a phantom binding; the native
/// menu picks the new accelerators up on next launch.
#[tauri::command(async)]
pub fn update_keybindings(
    keybindings: State<'_, KeybindingStorage>,
    bindings: HashMap<String, String>,
) -> Result<HashMap<String, String>, AppError> {
    let mut cleaned: HashMap<String, String> = HashMap::new();
    for (id, accel) in bindings.into_iter() {
        if !accel.trim().is_empty() {
            cleaned.insert(id, accel);
        }
    }
    match keybindings.save(&cleaned) {
        Ok(_) => Ok(cleaned),
        Err(e) => Err(e),
    }
}

#[tauri::command(async)]
pub fn get_default_query(
    dq:            State<'_, DefaultQueryStorage>,
    connection_id: String,
    database:      String,
    collection:    String,
) -> Option<DefaultQuery> {
    let key = format!("{}::{}::{}", connection_id, database, collection);
    dq.get(&key)
}

#[tauri::command(async)]
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
        mode,
        filter,
        sort,
        projection,
        skip,
        limit,
        pipeline,
        stamp: Stamp::now(),
    };
    dq.set(&key, entry)
}

#[tauri::command(async)]
pub fn clear_default_query(
    dq:            State<'_, DefaultQueryStorage>,
    connection_id: String,
    database:      String,
    collection:    String,
) -> Result<(), AppError> {
    let key = format!("{}::{}::{}", connection_id, database, collection);
    dq.clear(&key)
}

#[tauri::command(async)]
pub fn get_open_tabs(ts: State<'_, TabStorage>) -> Option<serde_json::Value> {
    ts.load()
}

#[tauri::command(async)]
pub fn set_open_tabs(
    ts:      State<'_, TabStorage>,
    session: serde_json::Value,
) -> Result<(), AppError> {
    ts.save(&session)
}

/// All persisted database/collection colour tags, as a map of node key
/// ("connId/db" or "connId/db/coll") to colour name. Loaded on startup so tags
/// survive a restart. Connection-level tags are not here — they live on the
/// connection config and come back with `list_connections`.
#[tauri::command(async)]
pub fn get_node_tags(tags: State<'_, NodeTagStorage>) -> HashMap<String, String> {
    tags.colors()
}

/// Set or clear the colour tag on a database/collection tree node. The colour
/// "none" clears the tag (marks the entry deleted) rather than storing it.
#[tauri::command(async)]
pub fn set_node_tag(
    tags:  State<'_, NodeTagStorage>,
    key:   String,
    color: String,
) -> Result<(), AppError> {
    
    if color == "none" {
        tags.clear(&key)
    } else {
        tags.set(&key, &color)
    }
}

/// Clear every database/collection colour tag under `prefix` (e.g. "connId/" for
/// a whole connection, or "connId/db/" for one database's collections). Used when
/// a parent's colour changes, so its descendants drop their own tags and take the
/// parent's colour.
#[tauri::command(async)]
pub fn clear_node_tags_under(
    tags:   State<'_, NodeTagStorage>,
    prefix: String,
) -> Result<(), AppError> {
    tags.remove_under(&prefix)
}

#[tauri::command(async)]
pub fn list_saved_queries(sq: State<'_, SavedQueryStorage>) -> Vec<SavedQueryEntry> {
    sq.load()
}

#[tauri::command(async)]
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
        name,
        mode,
        filter,
        sort,
        projection,
        skip,
        limit,
        pipeline,
        saved_at:   now_ms(),
        stamp:      Stamp::now(),
    };
    match sq.insert(entry) {
        Ok(_)  => Ok(id),
        Err(e) => Err(e),
    }
}

#[tauri::command(async)]
pub fn delete_saved_query(sq: State<'_, SavedQueryStorage>, id: String) -> Result<(), AppError> {
    sq.delete(&id)
}

#[tauri::command(async)]
pub fn get_query_history(
    history: State<'_, HistoryStorage>,
    connection_id: String,
    database: String,
    collection: String,
) -> Vec<QueryHistoryEntry> {
    let key = format!("{}::{}::{}", connection_id, database, collection);
    history.get(&key)
}

#[tauri::command(async)]
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
        mode,
        filter,
        sort,
        projection,
        skip,
        limit,
        pipeline,
        ran_at: now_ms(),
    };
    history.push(&key, entry)
}

#[tauri::command(async)]
pub fn clear_query_history(
    history: State<'_, HistoryStorage>,
    connection_id: String,
    database: String,
    collection: String,
) -> Result<(), AppError> {
    let key = format!("{}::{}::{}", connection_id, database, collection);
    history.clear(&key)
}
