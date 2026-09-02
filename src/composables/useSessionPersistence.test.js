import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { nextTick } from 'vue'

// The tab store builds its module-scope Quickstart through a definition, so the
// registry must be populated before any import that evaluates it — including this
// composable, which imports the store. Static imports run before this file's body,
// hence the dynamic imports below.
import { registerWorkspaceDefinitions } from '../workspaces/registerDefinitions'
registerWorkspaceDefinitions()

const { tabs, activeTabId } = await import('../stores/tabs')
const { useSessionPersistence } = await import('./useSessionPersistence')

vi.mock('../appApi/session', () => ({
  getOpenTabs: vi.fn(),
  setOpenTabs: vi.fn(() => Promise.resolve()),
}))
vi.mock('../engines/mongodb/api/connections', () => ({
  listConnections: vi.fn(() => Promise.resolve([
    { id: 'c1', name: 'Sales' },
    { id: 'c2', name: 'Analytics' },
  ])),
}))

const { getOpenTabs, setOpenTabs } = await import('../appApi/session')
const { listConnections } = await import('../engines/mongodb/api/connections')

const TARGET = (connId) => ({
  connectionId: connId,
  segments: [
    { kind: 'database', name: 'shop' },
    { kind: 'collection', name: 'orders' },
  ],
})

// A live find tab: canonical envelope + legacy flat fields + runtime junk.
const liveFind = (id, connId = 'c1') => ({
  id, type: 'mongodb.find', engine: 'mongodb', title: 'orders', color: '#0f0',
  target: TARGET(connId),
  kind: 'collection', connectionId: connId, connectionName: 'Sales',
  dbName: 'shop', collectionName: 'orders',
  mode: 'find', filter: '{ "a": 1 }', sort: '{}', projection: '{}',
  skip: 0, limit: 25, pipeline: '', vqb: { rows: [1] }, colOrder: { a: 0 }, readOnly: false,
  results: [{ x: 1 }], hasRun: true, isRunning: false, runError: null,
  selectedRow: 0, selectedRows: [0], elapsedMs: 12,
})

const canonicalFind = (id, connId = 'c1') => ({
  id, type: 'mongodb.find', engine: 'mongodb', title: 'orders', color: '#0f0',
  target: TARGET(connId),
  state: {
    filter: '{ "a": 1 }', sort: '{}', projection: '{}',
    skip: 0, limit: 25, pipeline: '', vqb: { rows: [1] }, colOrder: { a: 0 }, readOnly: false,
  },
})

// A legacy unversioned session record (the v1 disk format).
const legacyFind = (id, connId = 'c1') => ({
  id, kind: 'collection', title: 'orders', color: '#0f0',
  connectionId: connId, connectionName: 'Sales', dbName: 'shop', collectionName: 'orders',
  mode: 'find', filter: '{ "a": 1 }', sort: '{}', projection: '{}',
  skip: 0, limit: 25, pipeline: '', vqb: { rows: [1] }, colOrder: { a: 0 }, readOnly: false,
})

function seedStore(arr, activeId) {
  tabs.value = arr
  activeTabId.value = activeId
}

const autoSaves = []

beforeEach(() => {
  vi.resetAllMocks()
  setOpenTabs.mockResolvedValue(Promise.resolve())
  listConnections.mockResolvedValue([
    { id: 'c1', name: 'Sales' },
    { id: 'c2', name: 'Analytics' },
  ])
})

afterEach(() => {
  autoSaves.forEach(stop => stop())
  autoSaves.length = 0
  vi.useRealTimers()
})

// Autosave gating is per-instance, so the change must go through the same instance
// that initialized the session.
async function savedAfterChange(instance, tab) {
  vi.useFakeTimers()
  autoSaves.push(instance.startAutoSave())
  tabs.value = [...tabs.value, tab]
  await nextTick()
  vi.advanceTimersByTime(400)
}

describe('projection (v2 writes)', () => {
  it('projects live tabs to canonical v2 records with durable state only', async () => {
    seedStore([liveFind('f1')], 'f1')
    const session = useSessionPersistence()
    await session.initializeSession({ restore: false })
    await savedAfterChange(session, liveFind('f2'))
    expect(setOpenTabs).toHaveBeenCalledWith({
      schemaVersion: 2,
      activeTabId: 'f1',
      tabs: [canonicalFind('f1'), canonicalFind('f2')],
    })
  })

  it('excludes app-level tabs (quickstart) from the session', async () => {
    seedStore([liveFind('f1'), { id: 't0', type: 'app.quickstart', engine: 'app', kind: 'quickstart', title: 'Quickstart' }], 'f1')
    const session = useSessionPersistence()
    await session.initializeSession({ restore: false })
    await savedAfterChange(session, liveFind('f2'))
    expect(setOpenTabs).toHaveBeenCalledWith({ schemaVersion: 2, activeTabId: 'f1', tabs: [canonicalFind('f1'), canonicalFind('f2')] })
  })

  it('does not trigger saves on runtime-only changes', async () => {
    seedStore([liveFind('f1')], 'f1')
    const session = useSessionPersistence()
    await session.initializeSession({ restore: false })
    vi.useFakeTimers()
    autoSaves.push(session.startAutoSave())
    tabs.value[0].results = [{ y: 2 }]
    await nextTick()
    vi.advanceTimersByTime(400)
    expect(setOpenTabs).not.toHaveBeenCalled()
  })
})

describe('initializeSession', () => {
  it('treats a missing file as a fresh session and arms autosave', async () => {
    seedStore([], null)
    getOpenTabs.mockResolvedValue(null)
    const session = useSessionPersistence()
    const result = await session.initializeSession({ restore: true })
    expect(result).toEqual({ ok: true, sourceVersion: 2, migrated: false, warnings: [] })
    expect(tabs.value).toHaveLength(0)
    await savedAfterChange(session, liveFind('f1'))
    expect(setOpenTabs).toHaveBeenCalledWith({ schemaVersion: 2, activeTabId: null, tabs: [canonicalFind('f1')] })
  })

  it('migrates a legacy session and restores tabs with re-injected names', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    getOpenTabs.mockResolvedValue({
      activeTabId: 'r1',
      tabs: [legacyFind('r1'), {
        id: 'sh', kind: 'shell', title: 'mongosh: shop', color: null,
        connectionId: 'c2', connectionName: 'Analytics', dbName: 'shop',
        code: 'db.orders.find()', scriptPath: null,
      }],
    })
    const { initializeSession } = useSessionPersistence()
    const result = await initializeSession({ restore: true })
    expect(result).toEqual({ ok: true, sourceVersion: 1, migrated: true, warnings: [] })
    const find = tabs.value.find(t => t.id === 'r1')
    expect(find.type).toBe('mongodb.find')
    expect(find.filter).toBe('{ "a": 1 }')
    expect(find.connectionName).toBe('Sales')
    expect(find.dbName).toBe('shop')
    expect(find.collectionName).toBe('orders')
    expect(find.target).toEqual(TARGET('c1'))
    expect(find.results).toEqual([])
    expect(find.needsInitialRun).toBe(true)
    const shell = tabs.value.find(t => t.id === 'sh')
    expect(shell.connectionName).toBe('Analytics')
    expect(shell.code).toBe('db.orders.find()')
    expect(activeTabId.value).toBe('r1')
  })

  it('writes the migrated v2 session back once', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    getOpenTabs.mockResolvedValue({ activeTabId: 'r1', tabs: [legacyFind('r1')] })
    const { initializeSession } = useSessionPersistence()
    await initializeSession({ restore: false })
    expect(setOpenTabs).toHaveBeenCalledTimes(1)
    expect(setOpenTabs).toHaveBeenCalledWith({
      schemaVersion: 2,
      activeTabId: 'r1',
      tabs: [canonicalFind('r1')],
    })
  })

  it('drops tabs for deleted connections via migration pruning', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    getOpenTabs.mockResolvedValue({ activeTabId: 'r1', tabs: [legacyFind('r1', 'c1'), legacyFind('r3', 'c3')] })
    const { initializeSession } = useSessionPersistence()
    await initializeSession({ restore: true })
    const ids = tabs.value.map(t => t.id)
    expect(ids).toContain('r1')
    expect(ids).not.toContain('r3')
  })

  it('activates the repaired survivor when the requested v2 tab was pruned', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    getOpenTabs.mockResolvedValue({
      schemaVersion: 2,
      activeTabId: 'deleted',
      tabs: [canonicalFind('deleted', 'c3'), canonicalFind('survivor', 'c1')],
    })
    const { initializeSession } = useSessionPersistence()

    await initializeSession({ restore: true })

    expect(activeTabId.value).toBe('survivor')
    expect(tabs.value.find(t => t.id === 'survivor').needsInitialRun).toBe(true)
  })

  it('skips pruning when the connection list fails', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    listConnections.mockRejectedValue(new Error('offline'))
    getOpenTabs.mockResolvedValue({ activeTabId: 'r1', tabs: [legacyFind('r1', 'c3')] })
    const { initializeSession } = useSessionPersistence()
    const result = await initializeSession({ restore: true })
    expect(result.ok).toBe(true)
    expect(tabs.value.map(t => t.id)).toContain('r1')
  })

  it('does not restore ids that are already open', async () => {
    seedStore([liveFind('r1'), { id: 't0', kind: 'quickstart', title: 'Quickstart' }], 'r1')
    getOpenTabs.mockResolvedValue({ activeTabId: 'r1', tabs: [legacyFind('r1'), legacyFind('r2')] })
    const { initializeSession } = useSessionPersistence()
    await initializeSession({ restore: true })
    const ids = tabs.value.map(t => t.id)
    expect(ids.filter(id => id === 'r1')).toHaveLength(1)
    expect(ids).toContain('r2')
  })

  it('marks the active restored find for workspace-owned initial execution', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    getOpenTabs.mockResolvedValue({ activeTabId: 'r1', tabs: [legacyFind('r1')] })
    const { initializeSession } = useSessionPersistence()
    await initializeSession({ restore: true })
    expect(tabs.value.find(t => t.id === 'r1').needsInitialRun).toBe(true)
    await initializeSession({ restore: true })
    expect(tabs.value.filter(t => t.id === 'r1')).toHaveLength(1)
  })

  it('leaves an inactive restored find marked for first activation', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    getOpenTabs.mockResolvedValue({ activeTabId: 't0', tabs: [legacyFind('r1')] })
    const { initializeSession } = useSessionPersistence()
    await initializeSession({ restore: true })
    expect(activeTabId.value).toBe('t0')
    expect(tabs.value.find(t => t.id === 'r1').needsInitialRun).toBe(true)
  })

  it('does not auto-run restored aggregate or sql tabs', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    const aggregate = { ...legacyFind('a'), mode: 'aggregate', pipeline: '[{ "$match": {} }]' }
    const sql = { ...legacyFind('s'), mode: 'sql', sql: 'SELECT 1' }
    getOpenTabs.mockResolvedValue({ activeTabId: 'a', tabs: [aggregate, sql] })
    const { initializeSession } = useSessionPersistence()
    await initializeSession({ restore: true })
    const agg = tabs.value.find(t => t.id === 'a')
    const sq = tabs.value.find(t => t.id === 's')
    expect(agg.needsInitialRun).toBeUndefined()
    expect(sq.needsInitialRun).toBeUndefined()
    expect(agg.pipeline).toBe('[{ "$match": {} }]')
    expect(sq.sql).toBe('SELECT 1')
  })

  it('gives a restored shell a fresh session id', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    getOpenTabs.mockResolvedValue({
      activeTabId: 'sh',
      tabs: [{
        id: 'sh', kind: 'shell', title: 'mongosh: shop', color: null,
        connectionId: 'c1', connectionName: 'Sales', dbName: 'shop',
        sessionId: 'old-session', code: 'db.orders.find()', scriptPath: null,
      }],
    })
    const { initializeSession } = useSessionPersistence()
    await initializeSession({ restore: true })
    const shell = tabs.value.find(t => t.id === 'sh')
    expect(shell.sessionId).not.toBe('old-session')
    expect(shell.code).toBe('db.orders.find()')
  })

  it('restores schema and search as identity-only tabs', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    getOpenTabs.mockResolvedValue({
      activeTabId: 's',
      tabs: [
        { id: 's', kind: 'schema', title: 'Schema: orders', color: null, connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders' },
        { id: 'q', kind: 'search', title: 'Search: shop', color: null, connId: 'c1', connName: 'Sales', dbName: 'shop' },
      ],
    })
    const { initializeSession } = useSessionPersistence()
    await initializeSession({ restore: true })
    const schema = tabs.value.find(t => t.id === 's')
    const search = tabs.value.find(t => t.id === 'q')
    expect(schema.type).toBe('mongodb.schema')
    expect(schema.connName).toBe('Sales')
    expect(search.type).toBe('mongodb.search')
    expect(search.dbName).toBe('shop')
  })

  it('loads and validates without pushing tabs when restore is off', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    getOpenTabs.mockResolvedValue({ activeTabId: 'r1', tabs: [legacyFind('r1')] })
    const session = useSessionPersistence()
    const result = await session.initializeSession({ restore: false })
    expect(result.ok).toBe(true)
    expect(tabs.value.map(t => t.id)).toEqual(['t0'])
    await savedAfterChange(session, liveFind('f1'))
    expect(setOpenTabs).toHaveBeenCalledTimes(2) // migration writeback + autosave
  })

  it('keeps autosave armed on a valid v2 file with no migration writeback', async () => {
    seedStore([], null)
    getOpenTabs.mockResolvedValue({ schemaVersion: 2, activeTabId: null, tabs: [canonicalFind('r1')] })
    const session = useSessionPersistence()
    const result = await session.initializeSession({ restore: false })
    expect(result).toEqual({ ok: true, sourceVersion: 2, migrated: false, warnings: [] })
    expect(setOpenTabs).not.toHaveBeenCalled()
    await savedAfterChange(session, liveFind('f1'))
    expect(setOpenTabs).toHaveBeenCalledTimes(1)
  })

  it('disables autosave on a future-version file even when restore is off', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    getOpenTabs.mockResolvedValue({ schemaVersion: 3, activeTabId: 'r1', tabs: [canonicalFind('r1')] })
    const session = useSessionPersistence()
    const result = await session.initializeSession({ restore: false })
    expect(result).toEqual({ ok: false, reason: 'future-version', schemaVersion: 3 })
    await savedAfterChange(session, liveFind('f1'))
    expect(setOpenTabs).not.toHaveBeenCalled()
  })

  it('disables autosave on an invalid session file', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    getOpenTabs.mockResolvedValue({ schemaVersion: 2, tabs: 'not-an-array' })
    const session = useSessionPersistence()
    const result = await session.initializeSession({ restore: true })
    expect(result).toEqual({ ok: false, reason: 'invalid-session', schemaVersion: 2 })
    await savedAfterChange(session, liveFind('f1'))
    expect(setOpenTabs).not.toHaveBeenCalled()
  })

  it('disables autosave when the read fails', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    getOpenTabs.mockRejectedValue(new Error('io error'))
    const session = useSessionPersistence()
    const result = await session.initializeSession({ restore: true })
    expect(result).toEqual({ ok: false, reason: 'read-failed' })
    await savedAfterChange(session, liveFind('f1'))
    expect(setOpenTabs).not.toHaveBeenCalled()
  })
})

describe('stopAutoSave', () => {
  it('cancels the watcher and any pending debounced save', async () => {
    vi.useFakeTimers()
    seedStore([liveFind('f1')], 'f1')
    getOpenTabs.mockResolvedValue(null)
    const { initializeSession, startAutoSave, stopAutoSave } = useSessionPersistence()
    await initializeSession({ restore: true })
    autoSaves.push(startAutoSave())
    stopAutoSave()
    tabs.value = [...tabs.value, liveFind('f2')]
    await nextTick()
    vi.advanceTimersByTime(400)
    expect(setOpenTabs).not.toHaveBeenCalled()
  })
})
