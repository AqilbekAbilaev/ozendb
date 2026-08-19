// Query-library API: default queries, saved queries, and query history. Unlike the
// connection/database/collection commands, these key on connection_id (JS
// connectionId) — the backend keys its stores per connection — so the target
// translation here deliberately differs from the shared payload helpers.

import { invoke } from '@tauri-apps/api/core'

function targetPayload(target, extra = {}) {
  return {
    connectionId: target.connectionId,
    database:     target.database,
    collection:   target.collection,
    ...extra,
  }
}

export function getDefaultQuery(target) {
  return invoke('get_default_query', targetPayload(target))
}

export function setDefaultQuery(target, entry) {
  return invoke('set_default_query', targetPayload(target, entry))
}

export function clearDefaultQuery(target) {
  return invoke('clear_default_query', targetPayload(target))
}

export function listSavedQueries() {
  return invoke('list_saved_queries')
}

export function saveQuery(entry) {
  return invoke('save_query', entry)
}

export function deleteSavedQuery(id) {
  return invoke('delete_saved_query', { id })
}

export function getQueryHistory(target) {
  return invoke('get_query_history', targetPayload(target))
}

export function pushQueryHistory(target, entry) {
  return invoke('push_query_history', targetPayload(target, entry))
}

export function clearQueryHistory(target) {
  return invoke('clear_query_history', targetPayload(target))
}