use crate::json_store_wrapper;
use crate::error::AppError;
use crate::record::{Record, RecordList, Stamp};
use serde::{Deserialize, Serialize};

/// A connection-organizing folder shown in the Connection Manager grid. Folders
/// are their own entities (persisted in `folders.json`) so an empty folder can
/// exist before any connection is moved into it. `parent_id` is reserved for a
/// future nested-folder model; in the current flat model it is always `None`.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Folder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    pub created_at: String,
    #[serde(flatten)]
    pub stamp: Stamp,
}

crate::stamped!(Folder);

impl Record for Folder {
    fn id(&self) -> String {
        self.id.clone()
    }

    fn emptied(&self) -> Self {
        Folder { id: self.id.clone(), ..Folder::default() }
    }
}

json_store_wrapper!(FolderStorage, records of Folder);

impl FolderStorage {
    pub fn insert(&self, folder: Folder) -> Result<(), AppError> {
        self.inner.update(|folders| folders.put(folders.len(), folder))
    }

    pub fn rename(&self, id: &str, name: &str) -> Result<(), AppError> {
        self.inner.update(|folders| folders.edit_where(|f| f.id == id, |f| f.name = name.to_string()))
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        self.inner.update(|folders| folders.delete_where(|f| f.id == id))
    }
}

#[cfg(test)]
#[path = "folders.test.rs"]
mod tests;
