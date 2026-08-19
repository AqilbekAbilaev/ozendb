// Per-connection UI state: whether a sidebar connection node is expanded, and the
// last-accessed timestamp stamped when a connection is opened.

import { invoke } from '@tauri-apps/api/core'

export function setConnectionOpen(connectionId, open) {
  return invoke('set_connection_open', { id: connectionId, open })
}

export function updateLastAccessed(connectionId, timestamp) {
  return invoke('update_last_accessed', { id: connectionId, timestamp })
}