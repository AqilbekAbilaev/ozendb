// Mongo indexes API: listing, stats, create/drop, and the planner-visibility toggle.
// Every command takes a collection target; createIndex passes the raw keys/options
// JSON strings the Index form already produces.

import { invoke } from '@tauri-apps/api/core'
import { collectionPayload } from './payload'

export function listIndexes(target) {
  return invoke('list_indexes', collectionPayload(target))
}

export function indexStats(target) {
  return invoke('index_stats', collectionPayload(target))
}

export function createIndex(target, keys, options = '{}') {
  return invoke('create_index', collectionPayload(target, { keys, options }))
}

export function dropIndex(target, name) {
  return invoke('drop_index', collectionPayload(target, { name }))
}

export function setIndexHidden(target, name, hidden) {
  return invoke('set_index_hidden', collectionPayload(target, { name, hidden }))
}