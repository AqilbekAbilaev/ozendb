use crate::error::AppError;
use crate::folders::{Folder, FolderStorage};
use super::AppContext;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub fn list_folders(folders: State<'_, FolderStorage>) -> Vec<Folder> {
    folders.load()
}

#[tauri::command]
pub fn create_folder(
    folders: State<'_, FolderStorage>,
    name: String,
) -> Result<Folder, AppError> {
    let folder = Folder {
        id: Uuid::new_v4().to_string(),
        name: name,
        parent_id: None,
        created_at: crate::time::now_ms(),
    };
    match folders.insert(folder.clone()) {
        Ok(_) => Ok(folder),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn rename_folder(
    folders: State<'_, FolderStorage>,
    id: String,
    name: String,
) -> Result<(), AppError> {
    folders.rename(&id, &name)
}

/// Delete a folder. Any connection inside it falls back to the root (its
/// `folder_id` is cleared) rather than being deleted along with the folder.
#[tauri::command]
pub fn delete_folder(
    folders: State<'_, FolderStorage>,
    ctx: State<'_, AppContext>,
    id: String,
) -> Result<(), AppError> {
    // Detach any connections that were in this folder, under the storage lock.
    match ctx.storage.update_with(|connections| {
        for c in connections.iter_mut() {
            if c.folder_id.as_deref() == Some(id.as_str()) {
                c.folder_id = None;
            }
        }
    }) {
        Ok(_) => {}
        Err(e) => return Err(e),
    }
    folders.delete(&id)
}

/// Move a connection into a folder, or back to the root when `folder_id` is
/// `None`. A single-field update on the connection.
#[tauri::command]
pub fn move_connection_to_folder(
    ctx: State<'_, AppContext>,
    id: String,
    folder_id: Option<String>,
) -> Result<(), AppError> {
    ctx.storage.update_with(|connections| {
        if let Some(c) = connections.iter_mut().find(|c| c.id == id) {
            c.folder_id = folder_id;
        }
    })
}
