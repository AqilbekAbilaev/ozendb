// Mongo resources API: database, collection, and view discovery/lifecycle. Targets
// are { connectionId, database, collection }; create/drop/rename take a plain name
// argument where the backend has no collection-scoped key.

import { invoke } from '@tauri-apps/api/core'
import { connectionPayload, databasePayload, collectionPayload } from './payload'

export function listDatabases(connectionId) {
  return invoke('list_databases', connectionPayload(connectionId))
}

export function createCollection(target, name, options) {
  return invoke('create_collection', databasePayload(target, { name, ...(options && { options }) }))
}

export function createDatabase(target, firstCollection) {
  return invoke('create_database', databasePayload(target, { firstCollection }))
}

export function createView(target, name, viewOn, pipeline) {
  return invoke('create_view', databasePayload(target, { name, viewOn, pipeline }))
}

export function dropDatabase(target) {
  return invoke('drop_database', databasePayload(target))
}

export function dropCollection(target) {
  return invoke('drop_collection', collectionPayload(target))
}

export function renameCollection(target, newName) {
  return invoke('rename_collection', collectionPayload(target, { newName }))
}