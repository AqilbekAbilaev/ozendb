use crate::json_store_wrapper;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

/// Application-wide preferences. A single JSON object (not keyed), persisted to
/// `settings.json`. New fields should carry `#[serde(default)]` so older files
/// still deserialize.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Settings {
    #[serde(default = "default_query_limit")]
    pub default_query_limit: i64,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_result_view")]
    pub default_result_view: String,
    #[serde(default = "default_restore_session")]
    pub restore_session: bool,
    #[serde(default = "default_editor_tab_width")]
    pub editor_tab_width: i64,
    /// Webview zoom factor for the main window (1.0 = 100%).
    #[serde(default = "default_ui_zoom")]
    pub ui_zoom: f64,
}

fn default_query_limit() -> i64 {
    50
}

fn default_theme() -> String {
    "dark".to_string()
}

fn default_result_view() -> String {
    "table".to_string()
}

fn default_restore_session() -> bool {
    true
}

fn default_editor_tab_width() -> i64 {
    4
}

fn default_ui_zoom() -> f64 {
    1.0
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            default_query_limit: default_query_limit(),
            theme: default_theme(),
            default_result_view: default_result_view(),
            restore_session: default_restore_session(),
            editor_tab_width: default_editor_tab_width(),
            ui_zoom: default_ui_zoom(),
        }
    }
}

impl Settings {
    /// The settings by name, the shape sync merges them in.
    pub fn to_map(&self) -> Map<String, Value> {
        match serde_json::to_value(self) {
            Ok(Value::Object(map)) => map,
            _ => unreachable!("settings always serialize to a JSON object"),
        }
    }
}

/// The settings as stored: each setting's value, and when it last changed, so sync
/// can merge them one by one. Files written before the stamps existed have no
/// `updated_at`, so every setting counts as changed at 0, older than any real edit.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct StampedSettings {
    #[serde(flatten)]
    pub values: Settings,
    #[serde(default)]
    pub updated_at: BTreeMap<String, i64>,
}

impl StampedSettings {
    pub fn stamp_of(&self, key: &str) -> i64 {
        self.updated_at.get(key).copied().unwrap_or(0)
    }

    /// These settings once they change to `values` at `now`: only the settings whose
    /// value differs take the new stamp, so one change can't win a merge for the rest.
    pub fn changed_to(&self, values: Settings, now: i64) -> StampedSettings {
        let before = self.values.to_map();
        let mut updated_at = self.updated_at.clone();
        for (key, value) in values.to_map() {
            if before.get(&key) != Some(&value) {
                updated_at.insert(key, now);
            }
        }
        StampedSettings { values, updated_at }
    }
}

json_store_wrapper!(SettingsStorage, StampedSettings);

impl SettingsStorage {
    pub fn settings(&self) -> Settings {
        self.load().values
    }

    /// Applies `change` to the stored settings under the store's lock, so a sync that
    /// writes in between is never undone. Returns the settings before and after.
    pub fn update(&self, change: impl FnOnce(&Settings) -> Settings) -> Result<(Settings, Settings), AppError> {
        let now = crate::time::now_epoch_ms();
        self.inner.update(|stored| {
            let before = stored.values.clone();
            *stored = stored.changed_to(change(&before), now);
            (before, stored.values.clone())
        })
    }
}

#[cfg(test)]
#[path = "settings.test.rs"]
mod tests;
