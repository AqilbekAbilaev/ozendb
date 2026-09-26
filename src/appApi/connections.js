// Saved connections: testing, persistence, disconnect, and file import/export. Every
// engine shares one connections.json and one pool, so none of this is engine-specific.

import { invoke } from '@tauri-apps/api/core'

export function testConnection(id, fields) {
  return invoke('test_connection', { id, fields })
}

export function listConnections() {
  return invoke('list_connections')
}

export function saveConnection(fields, copySecretsFrom = null) {
  return invoke('save_connection', { fields, copySecretsFrom })
}

export function updateConnection(id, fields) {
  return invoke('update_connection', { id, fields })
}

export function deleteConnection(id) {
  return invoke('delete_connection', { id })
}

export function disconnect(id) {
  return invoke('disconnect', { id })
}

export function duplicateConnection(id) {
  return invoke('duplicate_connection', { id })
}

export function exportConnections(path) {
  return invoke('export_connections', { path })
}

export function importConnections(path) {
  return invoke('import_connections', { path })
}
