// Mongo documents API: document CRUD, bulk mutations, collection history, and the
// document editor window. All commands take a collection target except restoreHistory
// (entry-scoped) and openDocumentWindow (passes the DocumentTarget object itself).

import { invoke } from '@tauri-apps/api/core'
import { collectionPayload } from './payload'

export function insertDocument(target, document) {
  return invoke('insert_document', collectionPayload(target, { document }))
}

export function insertDocuments(target, documents) {
  return invoke('insert_documents', collectionPayload(target, { documents }))
}

export function replaceDocument(target, idFilter, document) {
  return invoke('replace_document', collectionPayload(target, { idFilter, document }))
}

export function deleteDocument(target, idFilter) {
  return invoke('delete_document', collectionPayload(target, { idFilter }))
}

export function updateMany(target, filter, update, options = {}) {
  return invoke('update_many', collectionPayload(target, {
    filter,
    update,
    upsert: options.upsert ?? false,
    multi: options.multi ?? false,
  }))
}

export function deleteMany(target, filter) {
  return invoke('delete_many', collectionPayload(target, { filter }))
}

export function clearCollection(target) {
  return invoke('clear_collection', collectionPayload(target))
}

export function listCollectionHistory(target) {
  return invoke('list_collection_history', collectionPayload(target))
}

export function clearCollectionHistory(target) {
  return invoke('clear_collection_history', collectionPayload(target))
}

export function restoreHistory(entryId) {
  return invoke('restore_history', { entryId })
}

export function openDocumentWindow(target) {
  return invoke('open_document_window', { target })
}