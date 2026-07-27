use crate::json_store_wrapper;
use crate::error::AppError;
use std::collections::HashMap;

// Persisted keyboard-shortcut overrides, keyed by menu-action id
// (e.g. "file:connect") with a Tauri accelerator string as the value
// (e.g. "CmdOrCtrl+N", "F4"). This is the single source of truth the native
// menu (menu.rs) and the frontend JS key handler both read, so a rebind stays
// consistent across the menu bar and the in-window shortcuts.
//
// Only ids the frontend knows about are ever written; an empty map means
// "use the built-in defaults everywhere".
json_store_wrapper!(KeybindingStorage, HashMap<String, String>);

impl KeybindingStorage {

    // Replace the whole binding map. The frontend sends the full effective set
    // (defaults + user changes) so the file is self-contained.
    pub fn save(&self, bindings: &HashMap<String, String>) -> Result<(), AppError> {
        self.inner.save(bindings)
    }
}
