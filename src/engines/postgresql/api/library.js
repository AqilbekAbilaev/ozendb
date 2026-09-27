// Saved SQL and the SQL each connection has run, newest first. History entries are
// `{ sql, ranAt }`; saved ones `{ id, name, connectionId, sql, savedAt }`.

import { invoke } from '@tauri-apps/api/core'

export const listHistory  = (connectionId) => invoke('list_pg_history', { connectionId })
export const pushHistory  = (connectionId, sql) => invoke('push_pg_history', { connectionId, sql })
export const clearHistory = (connectionId) => invoke('clear_pg_history', { connectionId })
export const listSaved    = (connectionId) => invoke('list_pg_saved', { connectionId })
export const saveQuery    = (connectionId, name, sql) => invoke('save_pg_query', { connectionId, name, sql })
export const deleteSaved  = (id) => invoke('delete_pg_saved', { id })
