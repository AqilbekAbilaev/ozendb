// Session migration specs (Work 7A). The round-trip tests at the bottom pin the
// v2 → legacy bridge against every definition's restore hook, so serialize,
// bridge and restore can never drift from each other.
import { describe, it, expect } from 'vitest'
import { migrateSession, toLegacyRecord } from './sessionMigration'
import { restoreWorkspace } from '../workspaces/lifecycle'
import { registerWorkspaceDefinitions } from '../workspaces/registerDefinitions'
import { getWorkspaceDefinition } from '../workspaces/registry'
import { legacy, expected, sessions } from './sessionMigration.fixtures'

registerWorkspaceDefinitions()

function sessionOf(result) {
  return {
    activeTabId: result.session.activeTabId,
    tabs: result.session.tabs.map(({ id, type, engine, title, color, target, state }) => ({ id, type, engine, title, color, target, state })),
  }
}

describe('legacy sessions (schemaVersion 1)', () => {
  it('migrates every persisted kind to its canonical v2 record', () => {
    const result = migrateSession(sessions.mixedLegacy)
    expect(result.ok).toBe(true)
    expect(result.sourceVersion).toBe(1)
    expect(result.migrated).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.requestedActiveTabId).toBe('w-find')
    expect(result.session.schemaVersion).toBe(2)
    expect(result.session.activeTabId).toBe('w-find')
    expect(result.session.tabs).toEqual([expected.find, expected.shell, expected.indexes, expected.currentOps])
  })

  it('never mutates the input', () => {
    const input = structuredClone(sessions.mixedLegacy)
    migrateSession(sessions.mixedLegacy)
    expect(sessions.mixedLegacy).toEqual(input)
  })

  it('projects only durable state, stripping runtime fields', () => {
    const result = migrateSession(sessions.runtimeStripping)
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([])
    expect(sessionOf(result).tabs).toEqual([expected.find])
  })

  it('keeps the first record per id and repairs a duplicate active id', () => {
    const result = migrateSession(sessions.duplicateIds)
    expect(result.ok).toBe(true)
    expect(result.session.activeTabId).toBe('w-find')
    expect(result.session.tabs.map((t) => t.id)).toEqual(['w-find', 'w-shell'])
    expect(result.session.tabs[0].state.filter).toBe('{ active: true }')
  })

  it('drops records with missing or non-string ids and repairs the active id', () => {
    const result = migrateSession(sessions.missingId)
    expect(result.ok).toBe(true)
    expect(result.session.activeTabId).toBe('w-export')
    expect(result.session.tabs.map((t) => t.id)).toEqual(['w-export'])
  })

  it('repairs a stale active id to the first survivor', () => {
    const result = migrateSession(sessions.staleActive)
    expect(result.ok).toBe(true)
    expect(result.session.activeTabId).toBe('w-shell')
    expect(result.requestedActiveTabId).toBe('gone')
  })

  it('prunes records for deleted connections when given the connection set', () => {
    const result = migrateSession(sessions.deletedConnection, { connections: new Set(['c2']) })
    expect(result.ok).toBe(true)
    expect(result.session.tabs).toEqual([])
    expect(result.session.activeTabId).toBe(null)
    expect(result.warnings).toEqual([
      { id: 'w-find', message: expect.stringContaining('connection no longer exists: c1') },
      { id: 'w-export', message: expect.stringContaining('connection no longer exists: c1') },
    ])
  })

  it('skips pruning when the connection list is unavailable', () => {
    const result = migrateSession(sessions.deletedConnection, { connections: null })
    expect(result.ok).toBe(true)
    expect(result.session.tabs.length).toBe(2)
    expect(result.warnings).toEqual([])
  })

  it('restores an empty session as an empty v2 session', () => {
    const result = migrateSession(sessions.empty)
    expect(result.ok).toBe(true)
    expect(result.requestedActiveTabId).toBe(null)
    expect(result.session).toEqual({ schemaVersion: 2, activeTabId: null, tabs: [] })
    expect(result.warnings).toEqual([])
  })

  it('survives unusual database and collection names unchanged', () => {
    const result = migrateSession(sessions.weirdNames)
    expect(result.ok).toBe(true)
    expect(result.session.tabs[0].target).toEqual({
      connectionId: 'c1',
      segments: [
        { kind: 'database', name: 'app/data' },
        { kind: 'collection', name: 'orders.v2 半角' },
      ],
    })
    expect(result.session.tabs[1].target.segments[0].name).toBe('db.with.dots')
  })

  it('preserves editor text exactly, including whitespace', () => {
    const result = migrateSession(sessions.whitespaceText)
    expect(result.ok).toBe(true)
    expect(result.session.tabs[0].state.filter).toBe('  {\n  "a": 1\n}\n')
    expect(result.session.tabs[0].state.sort).toBe('')
    expect(result.session.tabs[0].state.projection).toBe(' ')
  })

  it('maps a missing mode to the find workspace', () => {
    const result = migrateSession(sessions.missingMode)
    expect(result.ok).toBe(true)
    expect(result.session.tabs[0].type).toBe('mongodb.find')
  })

  it('skips unreadable kind/mode records with warnings, keeping the rest', () => {
    const result = migrateSession(sessions.unknownKind)
    expect(result.ok).toBe(true)
    expect(result.session.tabs).toEqual([])
    expect(result.warnings).toEqual([{ id: 'w1', message: expect.stringContaining('unreadable kind/mode') }])

    const modes = migrateSession(sessions.unknownMode)
    expect(modes.ok).toBe(true)
    expect(modes.session.tabs).toEqual([])
    expect(modes.warnings).toEqual([{ id: 'w1', message: expect.stringContaining('unreadable kind/mode') }])
  })

  it('skips records that cannot resolve a resource target, with a warning', () => {
    const result = migrateSession(sessions.missingTarget)
    expect(result.ok).toBe(true)
    expect(result.session.tabs).toEqual([])
    expect(result.warnings).toEqual([{ id: 'w1', message: expect.stringContaining('cannot resolve') }])
  })
})

describe('v2 sessions', () => {
  it('passes a valid session through untouched and canonical', () => {
    const result = migrateSession(sessions.validV2)
    expect(result.ok).toBe(true)
    expect(result.sourceVersion).toBe(2)
    expect(result.migrated).toBe(false)
    expect(result.warnings).toEqual([])
    expect(result.session).toEqual(sessions.validV2)
  })

  it('accepts an empty v2 session', () => {
    const result = migrateSession(sessions.validV2Empty)
    expect(result.ok).toBe(true)
    expect(result.session).toEqual({ schemaVersion: 2, activeTabId: null, tabs: [] })
  })

  it('repairs duplicate ids and stale actives in v2 sessions too', () => {
    const result = migrateSession(sessions.v2DuplicateIds)
    expect(result.ok).toBe(true)
    expect(result.session.activeTabId).toBe('w-find')
    expect(result.session.tabs.map((t) => t.id)).toEqual(['w-find', 'w-export'])
  })

  it('prunes v2 records for connections that no longer exist', () => {
    const result = migrateSession(sessions.validV2, { connections: new Set(['c2']) })

    expect(result.ok).toBe(true)
    expect(result.session.tabs).toEqual([])
    expect(result.session.activeTabId).toBe(null)
    expect(result.warnings).toEqual(sessions.validV2.tabs.map(tab => ({
      id: tab.id,
      message: expect.stringContaining('connection no longer exists: c1'),
    })))
  })

  it('fails the whole session on an unknown workspace type', () => {
    const result = migrateSession(sessions.v2UnknownType)
    expect(result).toEqual({ ok: false, reason: 'unknown-workspace-type', schemaVersion: 2 })
  })

  it('fails the whole session on a malformed record', () => {
    const result = migrateSession(sessions.v2MalformedRecord)
    expect(result).toEqual({ ok: false, reason: 'invalid-session', schemaVersion: 2 })
  })
})

describe('failure policy', () => {
  it('rejects sessions written by a newer schema version', () => {
    expect(migrateSession(sessions.future)).toEqual({ ok: false, reason: 'future-version', schemaVersion: 3 })
  })

  it('rejects non-numeric schema versions and broken envelopes as invalid', () => {
    expect(migrateSession(sessions.invalidVersion)).toEqual({ ok: false, reason: 'invalid-session', schemaVersion: '2' })
    expect(migrateSession(sessions.malformedEnvelope)).toEqual({ ok: false, reason: 'invalid-session', schemaVersion: 2 })
    expect(migrateSession(sessions.notAnObject)).toEqual({ ok: false, reason: 'invalid-session', schemaVersion: null })
  })
})

describe('serialize hooks', () => {
  const persistedTypes = [
    'mongodb.find', 'mongodb.aggregate', 'mongodb.sql_to_mql', 'mongodb.shell',
    'mongodb.indexes', 'mongodb.schema', 'mongodb.search',
    'mongodb.import', 'mongodb.export', 'mongodb.current_operations',
  ]

  it('every persisted workspace type exposes a serialize hook', () => {
    for (const type of persistedTypes) {
      expect(typeof getWorkspaceDefinition(type).serialize, type).toBe('function')
    }
  })

  it('each legacy fixture migrates to the pinned canonical record', () => {
    for (const key of Object.keys(expected)) {
      const result = migrateSession({ activeTabId: legacy[key].id, tabs: [legacy[key]] })
      expect(result.ok, key).toBe(true)
      expect(result.warnings, key).toEqual([])
      expect(result.session.tabs[0], key).toEqual(expected[key])
    }
  })
})

describe('toLegacyRecord bridge', () => {
  const restorable = {
    'mongodb.find': { key: 'find', kind: 'collection', name: 'Sales' },
    'mongodb.aggregate': { key: 'aggregate', kind: 'collection', name: 'Sales' },
    'mongodb.sql_to_mql': { key: 'sql', kind: 'collection', name: 'Sales' },
    'mongodb.shell': { key: 'shell', kind: 'shell', name: 'Sales' },
    'mongodb.indexes': { key: 'indexes', kind: 'indexes', name: 'Sales' },
    'mongodb.schema': { key: 'schema', kind: 'schema', name: 'Sales' },
    'mongodb.search': { key: 'search', kind: 'search', name: 'Sales' },
    'mongodb.import': { key: 'importCsv', kind: 'import', name: 'Sales' },
    'mongodb.export': { key: 'export', kind: 'export', name: 'Sales' },
    'mongodb.current_operations': { key: 'currentOps', kind: 'currentOps', name: 'Sales' },
  }

  // What each restore hook is trusted to bring back. Collection-mode names are
  // re-injected by the service from the connection list (see Work 7C), so they are
  // deliberately not asserted here.
  const DURABLE = {
    'mongodb.find': ['filter', 'sort', 'projection', 'skip', 'limit', 'pipeline', 'vqb', 'colOrder', 'readOnly'],
    'mongodb.aggregate': ['filter', 'sort', 'projection', 'skip', 'limit', 'pipeline', 'vqb', 'colOrder', 'readOnly'],
    'mongodb.sql_to_mql': ['sql', 'readOnly', 'colOrder'],
    'mongodb.shell': ['code', 'scriptPath'],
    'mongodb.indexes': [],
    'mongodb.schema': [],
    'mongodb.search': [],
    'mongodb.import': [],
    'mongodb.export': ['step', 'format', 'incremental', 'source', 'sourceCount', 'filter', 'fields'],
    'mongodb.current_operations': ['frequency', 'retention', 'ownOnly', 'showSys', 'slowOnly', 'slowSecs', 'dbName', 'collName', 'view'],
  }

  it('round-trips every persisted type through the legacy restore hooks', () => {
    for (const [type, conf] of Object.entries(restorable)) {
      const v2 = expected[conf.key]
      const legacyRecord = toLegacyRecord(v2, conf.name)
      expect(legacyRecord, type).not.toBe(null)
      expect(legacyRecord.kind, type).toBe(conf.kind)
      const restored = restoreWorkspace(legacyRecord)
      expect(restored, type).not.toBe(null)
      expect(restored.type, type).toBe(type)
      expect(restored.id, type).toBe(v2.id)
      expect(restored.title, type).toBe(v2.title)
      expect(restored.color, type).toBe(v2.color)
      expect(restored.target, type).toEqual(v2.target)
      // Flat identity comes back from the saved record (names were re-injected by
      // the bridge); durable state must match the pinned projection exactly.
      expect(restored, type).toMatchObject(legacy[conf.key])
      const durable = type === 'mongodb.import'
        ? (v2.state.format === 'csv'
            ? ['format', 'sourceType', 'filePath', 'csv', 'targetDb', 'targetColl', 'mode']
            : ['format', 'validate', 'sources'])
        : DURABLE[type]
      for (const key of durable) {
        expect(restored[key], `${type}.${key}`).toEqual(v2.state[key])
      }
    }
  })

  it('restores identity-only schema and search workspaces through the bridge', () => {
    const schema = toLegacyRecord(expected.schema, 'Sales')
    const search = toLegacyRecord(expected.search, 'Sales')
    const schemaTab = restoreWorkspace(schema)
    const searchTab = restoreWorkspace(search)
    expect(schemaTab.connId).toBe('c1')
    expect(schemaTab.connName).toBe('Sales')
    expect(schemaTab.dbName).toBe('shop')
    expect(schemaTab.collName).toBe('orders')
    expect(searchTab.connId).toBe('c1')
    expect(searchTab.connName).toBe('Sales')
    expect(searchTab.dbName).toBe('shop')
  })

  it('returns null for types outside the persisted set or unreadable targets', () => {
    expect(toLegacyRecord({ type: 'app.quickstart', target: null })).toBe(null)
    expect(toLegacyRecord({ type: 'mongodb.find', target: null })).toBe(null)
    expect(toLegacyRecord({ type: 'mongodb.find', target: { connectionId: '', segments: [] } })).toBe(null)
    expect(toLegacyRecord({ type: 'no.such.type' })).toBe(null)
    expect(toLegacyRecord(null)).toBe(null)
  })

  it('never throws for unknown types', () => {
    expect(() => toLegacyRecord({ type: 'no.such.type', id: 'x' })).not.toThrow()
    expect(() => toLegacyRecord({ id: 'x' })).not.toThrow()
  })
})
