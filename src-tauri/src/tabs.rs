use crate::error::AppError;
use std::path::PathBuf;

// Intentionally bespoke — not a JsonStore<T>: this store has no read-modify-write
// lock, and `load` returns `Option` (missing file -> `None`, not a `Default`
// value) so the caller can tell "no saved session" from "empty session".
pub struct TabStorage {
    path: PathBuf,
}

impl TabStorage {
    pub fn new(path: PathBuf) -> Self {
        Self { path: path }
    }

    pub fn load(&self) -> Option<serde_json::Value> {
        if !self.path.exists() {
            return None;
        }
        let content = match std::fs::read_to_string(&self.path) {
            Ok(val) => val,
            Err(_)  => return None,
        };
        match serde_json::from_str(&content) {
            Ok(val) => Some(val),
            // A truncated or corrupt session must never come back as "empty": the
            // frontend would treat it as a first run and overwrite the file on the
            // next autosave, destroying the user's session. Move the original bytes
            // aside so nothing overwrites them, and let the frontend read it as a
            // missing file. Best-effort: if the rename fails, the file stays and a
            // subsequent save overwrites it — there is nothing else we can do.
            Err(_) => {
                self.quarantine();
                None
            }
        }
    }

    fn quarantine(&self) {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let name = self
            .path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "tabs.json".to_string());
        let dest = self.path.with_file_name(format!("{name}.corrupt-{ts}.bak"));
        let _ = std::fs::rename(&self.path, &dest);
    }

    pub fn save(&self, session: &serde_json::Value) -> Result<(), AppError> {
        let content = match serde_json::to_string_pretty(session) {
            Ok(val) => val,
            Err(e)  => return Err(AppError::Serde(e)),
        };
        crate::persist::atomic_write(&self.path, &content)
    }
}

#[cfg(test)]
#[path = "tabs.test.rs"]
mod tests;