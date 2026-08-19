// Mongo transfer API: collection import/export (plain and field-mapped), preview
// reads of staged files, in-place duplication, and copy between collections on the
// same or different connections. `stage_import_text` stays a direct Tauri call
// because it is generic file staging, not a Mongo operation.

import { invoke } from '@tauri-apps/api/core'
import { collectionPayload } from './payload'

export function exportCollection(target, path, format) {
  return invoke('export_collection', collectionPayload(target, { path, format }))
}

export function exportCollectionFields(target, path, format, fields, options = {}) {
  const extra = { path, format, fields }
  if (options.incremental !== undefined) extra.incremental = options.incremental
  if (options.filter !== undefined) extra.filter = options.filter
  return invoke('export_collection_fields', collectionPayload(target, extra))
}

export function importCollection(target, path, format) {
  return invoke('import_collection', collectionPayload(target, { path, format }))
}

export function importCollectionMapped(target, path, format, mapping, csv) {
  const extra = { path, format, mapping }
  if (csv !== undefined) extra.csv = csv
  return invoke('import_collection_mapped', collectionPayload(target, extra))
}

export function importPreview(path, format, limit, csv) {
  const payload = { path, format, limit }
  if (csv !== undefined) payload.csv = csv
  return invoke('import_preview', payload)
}

export function duplicateCollection(target, name) {
  return invoke('duplicate_collection', {
    id:       target.connectionId,
    database: target.database,
    source:   target.collection,
    target:   name,
  })
}

export function copyCollection(connectionId, source, target) {
  return invoke('copy_collection', {
    id:               connectionId,
    sourceDatabase:   source.database,
    sourceCollection: source.collection,
    targetDatabase:   target.database,
    targetCollection: target.collection,
  })
}

export function copyCollectionToConnection(sourceId, source, targetId, target) {
  return invoke('copy_collection_to_connection', {
    sourceId,
    sourceDatabase:   source.database,
    sourceCollection: source.collection,
    targetId,
    targetDatabase:   target.database,
    targetCollection: target.collection,
  })
}