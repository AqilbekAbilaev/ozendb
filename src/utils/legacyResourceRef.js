// Pure adapters from every legacy frontend target shape to the canonical ResourceRef
// (Work 2B). These are the migration contract: the tree, tabs, feature nodes and the
// Mongo query API keep their current shapes, and conversion is lossless — or null
// when the input cannot name a resource. Malformed inputs return null instead of
// throwing, because they are shaped by user data and callers must not need try/catch.

import { createResourceRef, isResourceRef } from './resourceRef'

// Tool tabs and feature nodes use the short aliases (connId, collName); collection
// and shell tabs use the long ones (connectionId, collectionName). Reading long
// first keeps a single code path for both.
function targetFields(source) {
  return {
    connectionId: source.connectionId || source.connId || null,
    database: source.dbName || null,
    collection: source.collectionName || source.collName || null,
  }
}

function make(connectionId, segments) {
  if (!connectionId) return null
  try {
    return createResourceRef(connectionId, segments || [])
  } catch {
    return null
  }
}

function database(segments, name) {
  return [...segments, { kind: 'database', name: name }]
}

function collection(segments, databaseName, collectionName) {
  return [...database(segments, databaseName), { kind: 'collection', name: collectionName }]
}

// The tree selection carries an explicit `kind`; that is authoritative, and the
// shallower levels leave their deeper fields null.
export function resourceFromTreeSelection(selection) {
  if (!selection || typeof selection !== 'object') return null
  if (selection.kind === 'connection') return make(selection.connectionId)
  if (selection.kind === 'database') {
    return selection.dbName ? make(selection.connectionId, database([], selection.dbName)) : null
  }
  if (selection.kind === 'collection') {
    if (!selection.dbName || !selection.collectionName) return null
    return make(selection.connectionId, collection([], selection.dbName, selection.collectionName))
  }
  return null
}

// Feature nodes (context menus, modals, toolbar) have no explicit kind; depth is
// read from which of the short aliases are present.
export function resourceFromFeatureNode(node) {
  if (!node || typeof node !== 'object') return null
  const f = targetFields(node)
  if (!f.connectionId) return null
  if (!f.database) return f.collection ? null : make(f.connectionId)
  if (!f.collection) return make(f.connectionId, database([], f.database))
  return make(f.connectionId, collection([], f.database, f.collection))
}

// The Mongo query API target: { connectionId, database, collection } — the one
// shape whose collection key is neither long nor short.
export function resourceFromMongoTarget(target) {
  if (!target || typeof target !== 'object') return null
  if (!target.connectionId) return null
  if (!target.database) return target.collection ? null : make(target.connectionId)
  if (!target.collection) return make(target.connectionId, database([], target.database))
  return make(target.connectionId, collection([], target.database, target.collection))
}

// Tab scope is decided by the explicit kind table, never by field presence:
// currentOps carries dbName/collName as *filters*, not as its identity.
const TAB_SCOPES = {
  collection: 'collection',
  shell: 'database',
  indexes: 'collection',
  schema: 'collection',
  export: 'collection',
  import: 'collection', // the launch target; an import can fan out to other collections
  search: 'database',
  currentOps: 'connection',
  quickstart: null, // no resource
}

export function resourceFromLegacyTab(tab) {
  if (!tab || typeof tab !== 'object') return null
  const scope = TAB_SCOPES[tab.kind]
  if (scope === undefined) return null // unknown kind
  if (scope === null) return null // quickstart: no resource
  const f = targetFields(tab)
  if (scope === 'connection') return make(f.connectionId)
  if (scope === 'database') {
    return f.database ? make(f.connectionId, database([], f.database)) : null
  }
  if (!f.database || !f.collection) return null
  return make(f.connectionId, collection([], f.database, f.collection))
}

// Serialize only the legacy persisted node-tag keys (connection-id, .../database,
// .../database/collection). It never parses, so names containing `/` keep working;
// deeper or non-Mongo resources have no legacy key and yield null.
export function legacyNodeTagKey(resource) {
  if (!isResourceRef(resource)) return null
  const [db, coll] = resource.segments
  if (resource.segments.length === 0) return resource.connectionId
  if (resource.segments.length === 1) {
    return db.kind === 'database' ? `${resource.connectionId}/${db.name}` : null
  }
  if (resource.segments.length === 2) {
    return db.kind === 'database' && coll.kind === 'collection'
      ? `${resource.connectionId}/${db.name}/${coll.name}`
      : null
  }
  return null
}