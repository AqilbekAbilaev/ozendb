// Pure session migration. Turns whatever is on disk into a canonical v2
// session — or an explicit failure result the service must not overwrite. Every
// repair rule lives here and is pinned by fixtures, so a schema change can never
// silently change what a user's saved session means. Inputs are never mutated.
//
// Result shapes:
//   { ok: true, session, sourceVersion: 1|2, migrated, warnings: [{ id, message }] }
//   { ok: false, reason: 'invalid-session'|'future-version'|'unknown-workspace-type',
//     schemaVersion }
//
// Durable state is projected by the workspace definitions' serialize hooks —
// the migration hands each legacy record to its definition, so there is exactly one
// source of truth for what survives a session.
import { getWorkspaceDefinition, workspaceTypeForSaved } from './registry'
import { createResourceRef, isResourceRef } from '../utils/resourceRef'

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

// A v1 record names its tab by `kind` and spells its identity flat: the long way
// (connectionId/collectionName) on collection and shell tabs, the short way
// (connId/collName) on tool tabs. Its depth comes from the kind, never from which
// fields are set, because Current Operations carries dbName/collName as filters.
const V1_DEPTH = { collection: 2, shell: 1, indexes: 2, schema: 2, export: 2, import: 2, search: 1, currentOps: 0 }

// The ResourceRef a v1 record names, or null when it names none: Quickstart, an
// unknown kind, or a record missing a name its depth needs.
function resourceFromV1Record(record) {
  const depth = V1_DEPTH[record?.kind]
  if (depth === undefined) return null
  const connectionId = record.connectionId || record.connId
  const names = [record.dbName, record.collectionName || record.collName].slice(0, depth)
  if (!isNonEmptyString(connectionId) || !names.every(isNonEmptyString)) return null
  return createResourceRef(connectionId, names.map((name, i) => ({ kind: i === 0 ? 'database' : 'collection', name })))
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
  const target = resourceFromV1Record(record)
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
function validateV2(raw, connections, warnings) {
  const out = []
  for (const r of raw.tabs) {
    if (!isPlainObject(r) || !isValidId(r.id)) return null
    if (typeof r.type !== 'string' || !knownType(r.type)) return { reason: 'unknown-workspace-type' }
    const def = getWorkspaceDefinition(r.type)
    if (def.engine !== 'app' && !isValidTarget(r.target)) return null
    if (!isPlainObject(r.state)) return null
    if (r.target && connections && !connections.has(r.target.connectionId)) {
      warnings.push({ id: r.id, message: `connection no longer exists: ${r.target.connectionId}` })
      continue
    }
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
  const warnings = []
  const validated = validateV2(raw, connections, warnings)
  if (validated === null) return { ok: false, reason: 'invalid-session', schemaVersion: 2 }
  if (validated.reason) return { ok: false, reason: validated.reason, schemaVersion: 2 }
  return okResult(buildSession(validated.tabs, raw.activeTabId), 2, false, warnings, raw)
}

// Whether a saved type can come back: exactly the types whose definition has a
// restore hook, so the bridge can never leave out a type the definitions can restore
// (#313: search tabs were saved but never restored, missing from a hand-kept list).
function restorable(type) {
  return knownType(type) && !!getWorkspaceDefinition(type).restore
}

// The v2 → restore bridge. Restore hooks read one flat record: the saved `type` and
// `target`, which is the workspace's whole identity (#303), the display name
// re-resolved from the connection list (names are not identity, so they are never
// stored), and the durable state spread beside them. The state goes first, so no key
// in it can ever overwrite the record's identity. Returns null for a type that cannot
// be restored, or a record without a valid target.
export function toRestoreRecord(v2, connectionName = null) {
  if (!v2 || !restorable(v2.type) || !isValidTarget(v2.target)) return null
  return {
    ...v2.state,
    id: v2.id,
    type: v2.type,
    target: v2.target,
    title: v2.title,
    color: v2.color,
    connectionName: connectionName,
  }
}

// What to tell the user about an initializeSession result. A failure also switched
// autosave off, so the toast has to say the tabs will not be kept — the missing old
// ones are the smaller loss. Per-tab warnings only explain a gap, so they just log.
const FAILURE_TEXT = {
  'read-failed':            'Could not read the saved session',
  'invalid-session':        'The saved session file is not valid',
  'future-version':         'The saved session was written by a newer version of OzenDB',
  'unknown-workspace-type': 'The saved session contains a tab type this version does not know',
}

export function sessionRestoreNotice(result) {
  if (!result.ok) {
    const what = FAILURE_TEXT[result.reason] || 'Could not restore the saved session'
    return { toast: `${what} — tabs will not be saved this run.`, log: `session restore: ${result.reason}` }
  }
  if (!result.warnings.length) return { toast: null, log: null }
  const lines = result.warnings.map((w) => `${w.id ?? '?'}: ${w.message}`)
  return { toast: null, log: `session restore skipped ${lines.length} tab(s): ${lines.join('; ')}` }
}
