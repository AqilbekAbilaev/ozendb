import { ref } from 'vue'
import { listDatabases } from '../engines/mongodb/api/resources'
import { listSchemas } from '../engines/postgresql/api/resources'

// The databases the sidebar has fetched for each connection, keyed by connection id.
//
// Module-scope rather than local to ConnectionTree because it answers a question the
// connection editor also needs: is anything on screen still describing the server this
// connection currently points at? An entry here means the tree is showing databases
// fetched from that server, so repointing the connection elsewhere would leave what the
// user is looking at describing a machine it no longer talks to.
//
// The pool can't answer that — it's evicted on every save and refilled by any
// operation, so it goes cold while the tree carries on displaying what it already has.
// A connection's top level: MongoDB's databases, PostgreSQL's schemas.
export const connDatabases = ref({})   // connId → DatabaseInfo[] | PgSchemaInfo[]
export const connectionResourceLoading = ref({})
export const connectionResourceErrors = ref({})

const requestGenerations = new Map()
const pendingRequests = new Map()
const staleConnections = new Set()

const LOADERS = { mongodb: listDatabases, postgresql: listSchemas }
// Recorded by the tree's first load, so a later refresh from a caller that only knows
// the id still reaches the right engine.
const connectionEngines = new Map()   // connId → engine

function remember(id, engine) {
  if (engine) connectionEngines.set(id, engine)
}

function hasOwn(record, id) {
  return Object.prototype.hasOwnProperty.call(record, id)
}

function without(record, id) {
  const next = { ...record }
  delete next[id]
  return next
}

function advanceGeneration(id) {
  const generation = (requestGenerations.get(id) || 0) + 1
  requestGenerations.set(id, generation)
  return generation
}

/** Whether the sidebar currently holds databases fetched for this connection. */
export function hasLoadedData(id) {
  return hasOwn(connDatabases.value, id)
}

function loadConnectionResources(id) {
  const generation = advanceGeneration(id)
  connectionResourceLoading.value = { ...connectionResourceLoading.value, [id]: true }
  connectionResourceErrors.value = without(connectionResourceErrors.value, id)

  const request = (async () => {
    try {
      const databases = await LOADERS[connectionEngines.get(id) ?? 'mongodb'](id)
      if (requestGenerations.get(id) === generation) {
        connDatabases.value = { ...connDatabases.value, [id]: databases }
        staleConnections.delete(id)
      }
      return databases
    } catch (error) {
      if (requestGenerations.get(id) === generation) {
        connectionResourceErrors.value = { ...connectionResourceErrors.value, [id]: error }
      }
      throw error
    } finally {
      if (requestGenerations.get(id) === generation) {
        connectionResourceLoading.value = { ...connectionResourceLoading.value, [id]: false }
      }
      if (pendingRequests.get(id) === request) pendingRequests.delete(id)
    }
  })()

  pendingRequests.set(id, request)
  return request
}

export function ensureConnectionResources(id, engine) {
  remember(id, engine)
  if (hasLoadedData(id) && !staleConnections.has(id)) return Promise.resolve(connDatabases.value[id])
  return pendingRequests.get(id) || loadConnectionResources(id)
}

export function refreshConnectionResources(id, engine) {
  remember(id, engine)
  return loadConnectionResources(id)
}

export function invalidateConnectionResources(id) {
  const shouldRefresh = hasLoadedData(id) || connectionResourceLoading.value[id] === true
  if (shouldRefresh) staleConnections.add(id)
  advanceGeneration(id)
  if (shouldRefresh) refreshConnectionResources(id).catch(() => {})
}

export function clearConnectionResources(id) {
  advanceGeneration(id)
  pendingRequests.delete(id)
  staleConnections.delete(id)
  connectionEngines.delete(id)
  connDatabases.value = without(connDatabases.value, id)
  connectionResourceLoading.value = without(connectionResourceLoading.value, id)
  connectionResourceErrors.value = without(connectionResourceErrors.value, id)
}
