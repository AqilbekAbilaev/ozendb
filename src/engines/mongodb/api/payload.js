// Shared wire-payload translation for the Mongo API. Frontend-facing targets are
// { connectionId, database, collection } objects; the backend expects the id key
// (or connection_id in the few history commands) plus explicit database/collection
// keys. These helpers are the only place that translation happens, so every API
// module spells targets the same way.

// A ResourceRef as the target the API modules take: { connectionId, database,
// collection }, leaving out the levels the ref does not reach. This is the one place a
// ref becomes that shape, so callers holding a ref never spell it out by hand.
export function apiTarget(resource) {
  const [database, collection] = resource.segments
  return {
    connectionId: resource.connectionId,
    ...(database ? { database: database.name } : {}),
    ...(collection ? { collection: collection.name } : {}),
  }
}

export function connectionPayload(connectionId, extra = {}) {
  return { ...extra, id: connectionId }
}

export function databasePayload(target, extra = {}) {
  return { ...extra, id: target.connectionId, database: target.database }
}

export function collectionPayload(target, extra = {}) {
  return {
    ...extra,
    id:         target.connectionId,
    database:   target.database,
    collection: target.collection,
  }
}