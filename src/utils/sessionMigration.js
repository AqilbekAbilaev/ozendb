// Pure session migration (Work 7A). Turns whatever is on disk into a canonical v2
// session — or an explicit failure result the service must not overwrite. Every
// repair rule lives here and is pinned by fixtures, so a schema change can never
// silently change what a user's saved session means. Inputs are never mutated.
//
// Result shapes:
//   { ok: true, session, sourceVersion: 1|2, migrated, warnings: [{ id, message }] }
//   { ok: false, reason: 'invalid-session'|'future-version'|'unknown-workspace-type',
//     schemaVersion }
//
// Durable state is projected by the workspace definitions' serialize hooks (7B) —
// the migration hands each legacy record to its definition, so there is exactly one
// source of truth for what survives a session.
import { getWorkspaceDefinition, workspaceTypeForSaved } from '../workspaces/registry'
import { resourceFromLegacyTab } from './legacyResourceRef'
import { isResourceRef } from './resourceRef'

function isValidId(id) {
  return typeof id === 'string' && id.length > 0
}

function isValidTarget(target) {
  return isResourceRef(target) && isNonEmptyString(target.connectionId)
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function knownType(type) {
  try {
    getWorkspaceDefinition(type)
    return true
  } catch {
    return false
  }
}

// Envelope checks come first: a file that is not a session at all must fail as a
// whole, never be treated as an empty session that a save would happily overwrite.
function envelopeVersion(raw) {
  if (!isPlainObject(raw) || !Array.isArray(raw.tabs)) return { kind: 'invalid' }
  const v = raw.schemaVersion
  if (v === undefined || v === 1) return { kind: 'legacy' }
  if (v === 2) return { kind: 2 }
  if (typeof v === 'number' && v > 2) return { kind: 'future', schemaVersion: v }
  return { kind: 'invalid' }
}

// One legacy record → one canonical v2 record, or null with a warning. Durable
// state comes from the definition's serialize hook; connection pruning happens
// here so the migration stays a single pure pass (null `connections` = do not
// prune — a failed connection load must not read as "everything was deleted").
function migrateLegacyRecord(record, connections, warnings) {
  const type = workspaceTypeForSaved(record)
  if (!type) {
    warnings.push({ id: record && record.id ? record.id : null, message: `unreadable kind/mode: ${record && record.kind}/${record && record.mode}` })
    return null
  }
  const def = getWorkspaceDefinition(type)
  const target = resourceFromLegacyTab(record)
  if (def.engine !== 'app' && !target) {
    warnings.push({ id: record.id, message: `cannot resolve a resource target for ${type}` })
    return null
  }
  if (target && connections && !connections.has(target.connectionId)) {
    warnings.push({ id: record.id, message: `connection no longer exists: ${target.connectionId}` })
    return null
  }
  return {
    id: record.id,
    type: type,
    engine: def.engine,
    title: typeof record.title === 'string' ? record.title : '',
    color: record.color ?? null,
    target: target,
    state: def.serialize ? def.serialize(record) : {},
  }
}

// Validate a v2 session. Canonical by contract, so any record that is not: unknown
// type fails the whole file (never partially restore), and a malformed record fails
// it too (never let a broken file quietly lose the tabs after it).
function validateV2(raw) {
  const out = []
  for (const r of raw.tabs) {
    if (!isPlainObject(r) || !isValidId(r.id)) return null
    if (typeof r.type !== 'string' || !knownType(r.type)) return { reason: 'unknown-workspace-type' }
    const def = getWorkspaceDefinition(r.type)
    if (def.engine !== 'app' && !isValidTarget(r.target)) return null
    if (!isPlainObject(r.state)) return null
    out.push({
      id: r.id,
      type: r.type,
      engine: def.engine,
      title: typeof r.title === 'string' ? r.title : '',
      color: r.color ?? null,
      target: def.engine === 'app' ? (r.target ?? null) : r.target,
      state: r.state,
    })
  }
  return { tabs: out }
}

// Common repair for both paths: drop missing/invalid ids, keep the first record
// per id, preserve relative order, and repair the active id to a survivor (or the
// first survivor, or null). The requested active id is surfaced separately: a file
// whose active id is a non-session tab (the app's always-present quickstart) must
// not be re-pointed at the first restored tab, because the restore service decides
// activation from the requested id, not the repaired one.
function buildSession(records, activeTabId) {
  const seen = new Set()
  const survivors = []
  for (const r of records) {
    if (!isValidId(r.id) || seen.has(r.id)) continue
    seen.add(r.id)
    survivors.push(r)
  }
  const active = isValidId(activeTabId) && seen.has(activeTabId)
    ? activeTabId
    : (survivors.length ? survivors[0].id : null)
  return { schemaVersion: 2, activeTabId: active, tabs: survivors }
}

function okResult(session, sourceVersion, migrated, warnings, raw) {
  return {
    ok: true,
    session: session,
    sourceVersion: sourceVersion,
    migrated: migrated,
    warnings: warnings,
    requestedActiveTabId: raw && typeof raw.activeTabId === 'string' ? raw.activeTabId : null,
  }
}

export function migrateSession(raw, { connections = null } = {}) {
  const envelope = envelopeVersion(raw)
  if (envelope.kind === 'invalid') {
    return { ok: false, reason: 'invalid-session', schemaVersion: raw && raw.schemaVersion !== undefined ? raw.schemaVersion : null }
  }
  if (envelope.kind === 'future') {
    return { ok: false, reason: 'future-version', schemaVersion: envelope.schemaVersion }
  }
  if (envelope.kind === 'legacy') {
    const warnings = []
    const records = raw.tabs
      .map((t) => migrateLegacyRecord(t, connections, warnings))
      .filter(Boolean)
    return okResult(buildSession(records, raw.activeTabId), 1, true, warnings, raw)
  }
  const validated = validateV2(raw)
  if (validated === null) return { ok: false, reason: 'invalid-session', schemaVersion: 2 }
  if (validated.reason) return { ok: false, reason: validated.reason, schemaVersion: 2 }
  return okResult(buildSession(validated.tabs, raw.activeTabId), 2, false, [], raw)
}

// Per-type legacy key conventions for the restore bridge: collection/shell records
// carry the long keys, tool records the short aliases, and the connection scope of
// a current-ops record is empty even when its filters are populated.
const LEGACY_KEYS = {
  'mongodb.find':           { kind: 'collection', long: true, extra: { mode: 'find' } },
  'mongodb.aggregate':      { kind: 'collection', long: true, extra: { mode: 'aggregate' } },
  'mongodb.sql_to_mql':     { kind: 'collection', long: true, extra: { mode: 'sql' } },
  'mongodb.shell':          { kind: 'shell', long: true },
  'mongodb.indexes':        { kind: 'indexes', short: true },
  'mongodb.schema':         { kind: 'schema', short: true },
  'mongodb.search':         { kind: 'search', short: true },
  'mongodb.import':         { kind: 'import', short: true },
  'mongodb.export':         { kind: 'export', short: true },
  'mongodb.current_operations': { kind: 'currentOps', short: true },
}

// The v2 → legacy bridge. Restore hooks (Work 6) consume the flat legacy shape and
// are deliberately unchanged; this un-projects the canonical record back into it,
// with the display name re-resolved from the connection list (names are not
// identity, so they are never stored). Returns null for types outside the table.
export function toLegacyRecord(v2, connectionName = null) {
  const conf = LEGACY_KEYS[v2 && v2.type]
  if (!conf || !isValidTarget(v2.target)) return null
  const [db] = v2.target.segments
  const coll = v2.target.segments[1]
  const identity = conf.long
    ? {
        connectionId: v2.target.connectionId,
        connectionName: connectionName,
        dbName: db ? db.name : null,
        collectionName: coll ? coll.name : null,
      }
    : {
        connId: v2.target.connectionId,
        connName: connectionName,
        dbName: db ? db.name : null,
        collName: coll ? coll.name : null,
      }
  return {
    id: v2.id,
    kind: conf.kind,
    title: v2.title,
    color: v2.color,
    ...identity,
    ...(conf.extra || {}),
    ...v2.state,
  }
}