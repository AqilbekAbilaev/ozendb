// Mongo connection API: testing, persistence, URI assembly, and disconnect. The
// connection-level commands key on `id`, so payloads go through the shared
// connectionPayload helper where a translation is more than pass-through.

import { invoke } from '@tauri-apps/api/core'
import { connectionPayload } from './payload'

export function testConnection(id, fields) {
  return invoke('test_connection', { id, fields })
}

export function testSshConnection(fields) {
  return invoke('test_ssh_connection', fields)
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
  return invoke('delete_connection', connectionPayload(id))
}

export function disconnect(id) {
  return invoke('disconnect', connectionPayload(id))
}

export function connectionUri(id) {
  return invoke('connection_uri', connectionPayload(id))
}

export function duplicateConnection(id) {
  return invoke('duplicate_connection', connectionPayload(id))
}

export function exportConnections(path) {
  return invoke('export_connections', { path })
}

export function importConnections(path) {
  return invoke('import_connections', { path })
}