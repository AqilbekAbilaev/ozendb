// Saved SQL and the SQL each connection has run, newest first, for every SQL engine
// (commands/sql/library.rs). History entries are `{ sql, ranAt }`; saved ones
// `{ id, name, connectionId, sql, savedAt }`.

import { invoke } from '@tauri-apps/api/core'

export const listHistory  = (connectionId) => invoke('list_sql_history', { connectionId })
export const pushHistory  = (connectionId, sql) => invoke('push_sql_history', { connectionId, sql })
export const clearHistory = (connectionId) => invoke('clear_sql_history', { connectionId })
export const listSaved    = (connectionId) => invoke('list_sql_saved', { connectionId })
export const saveQuery    = (connectionId, name, sql) => invoke('save_sql_query', { connectionId, name, sql })
export const deleteSaved  = (id) => invoke('delete_sql_saved', { id })
