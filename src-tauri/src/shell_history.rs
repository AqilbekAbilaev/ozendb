use crate::json_store_wrapper;
use crate::error::AppError;
use std::collections::HashMap;

const MAX_HISTORY: usize = 200;

// Per-connection IntelliShell command history, persisted to shell_history.json.
// Commands are stored oldest-first so the frontend can use the list directly
// for ↑/↓ recall.
json_store_wrapper!(ShellHistoryStorage, HashMap<String, Vec<String>>);

impl ShellHistoryStorage {
    pub fn get(&self, key: &str) -> Vec<String> {
        let map = self.load();
        match map.get(key) {
            Some(commands) => commands.clone(),
            None => Vec::new(),
        }
    }

    // Append a command, moving any existing identical entry to the most-recent
    // position and capping the list to the newest MAX_HISTORY commands.
    pub fn push(&self, key: &str, command: String) -> Result<(), AppError> {
        self.inner.update(|map| {
            let commands = map.entry(key.to_string()).or_insert_with(Vec::new);
            commands.retain(|existing| existing != &command);
            commands.push(command);
            if commands.len() > MAX_HISTORY {
                let overflow = commands.len() - MAX_HISTORY;
                commands.drain(0..overflow);
            }
        })
    }

    pub fn clear(&self, key: &str) -> Result<(), AppError> {
        self.inner.update(|map| {
            map.remove(key);
        })
    }
}
