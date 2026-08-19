// Connection folder CRUD and assignment. Folders are the sidebar's grouping layer.

import { invoke } from '@tauri-apps/api/core'

export function listFolders() {
  return invoke('list_folders')
}

export function createFolder(name) {
  return invoke('create_folder', { name })
}

export function renameFolder(id, name) {
  return invoke('rename_folder', { id, name })
}

export function deleteFolder(id) {
  return invoke('delete_folder', { id })
}

export function moveConnectionToFolder(connectionId, folderId) {
  return invoke('move_connection_to_folder', { id: connectionId, folderId })
}