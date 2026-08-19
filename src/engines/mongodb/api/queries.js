// Frontend-facing MongoDB query API. Every operation takes a target
// { connectionId, database, collection } — except cancelRun, which only needs the
// connection — and translates it into the Tauri command payloads the backend
// expects. This is the single place that knows query command names and their wire
// shapes; the rest of the frontend talks targets, not commands.

import { invoke } from '@tauri-apps/api/core'
import { connectionPayload, collectionPayload } from './payload'

export function runFind(target, query, runId) {
  return invoke('find_documents', collectionPayload(target, { ...query, comment: runId }))
}

export function runAggregate(target, pipeline, runId) {
  return invoke('run_aggregate', collectionPayload(target, { pipeline, comment: runId }))
}

export function cancelRun(connectionId, runId) {
  return invoke('kill_query', connectionPayload(connectionId, { comment: runId }))
}

export function countDocuments(target, filter) {
  return invoke('count_documents', collectionPayload(target, { filter }))
}

// Collection is optional (null searches the whole database); the optional tuning
// knobs are only sent when the caller provides them.
export function searchCollections(target, term, options = {}) {
  const extra = { term: term }
  for (const key of ['scope', 'matchCase', 'regex', 'scanLimit', 'maxHits']) {
    if (options[key] !== undefined) extra[key] = options[key]
  }
  return invoke('search_collections', {
    ...collectionPayload(target, extra),
    collection: options.collection ?? null,
  })
}

export function mapReduce(target, { map, reduce, finalize, outCollection }) {
  return invoke('map_reduce', collectionPayload(target, { map, reduce, finalize, outCollection }))
}

export function recordHistory(target, entry) {
  return invoke('push_query_history', {
    connectionId: target.connectionId,
    database:     target.database,
    collection:   target.collection,
    mode:         entry.mode,
    filter:       entry.filter,
    sort:         entry.sort,
    projection:   entry.projection,
    skip:         entry.skip,
    limit:        entry.limit,
    pipeline:     entry.pipeline,
  })
}

export function translateSqlToMql(sql) {
  return invoke('translate_sql', { sql })
}

export function explainFind(target, query, verbosity) {
  return invoke('explain_query', collectionPayload(target, { ...query, verbosity }))
}

export function explainAggregate(target, pipeline, verbosity) {
  return invoke('explain_aggregate', collectionPayload(target, { pipeline, verbosity }))
}

// On-disk sizes for the Explain plan's Collection/Index target nodes, normalized
// from the raw collection_stats response. Best-effort by contract: callers treat a
// rejection here as "skip the size nodes", never as an explain failure.
export async function loadExplainStorage(target) {
  const stats = await invoke('collection_stats', collectionPayload(target))
  const indexSizes = {}
  for (const ix of (stats.indexes || [])) indexSizes[ix.name] = ix.size
  return { dataSize: stats.size, indexSizes }
}