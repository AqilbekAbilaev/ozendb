use crate::json_store_wrapper;
use crate::error::AppError;
use serde::{Deserialize, Serialize};

/// A connection-organizing folder shown in the Connection Manager grid. Folders
/// are their own entities (persisted in `folders.json`) so an empty folder can
/// exist before any connection is moved into it. `parent_id` is reserved for a
/// future nested-folder model; in the current flat model it is always `None`.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Folder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    pub created_at: String,
}

json_store_wrapper!(FolderStorage, Vec<Folder>);

impl FolderStorage {
    pub fn insert(&self, folder: Folder) -> Result<(), AppError> {
        self.inner.update(|folders| folders.push(folder))
    }

    pub fn rename(&self, id: &str, name: &str) -> Result<(), AppError> {
        self.inner.update(|folders| {
            if let Some(f) = folders.iter_mut().find(|f| f.id == id) {
                f.name = name.to_string();
            }
        })
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        self.inner.update(|folders| folders.retain(|f| f.id != id))
    }
}
