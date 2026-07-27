use crate::json_store_wrapper;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

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

impl Default for Settings {
    fn default() -> Self {
        Self {
            default_query_limit: default_query_limit(),
            theme: default_theme(),
            default_result_view: default_result_view(),
            restore_session: default_restore_session(),
            editor_tab_width: default_editor_tab_width(),
        }
    }
}

json_store_wrapper!(SettingsStorage, Settings);

impl SettingsStorage {
    pub fn save(&self, settings: &Settings) -> Result<(), AppError> {
        self.inner.save(settings)
    }
}
