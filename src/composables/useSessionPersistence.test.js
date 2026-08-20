import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { nextTick } from 'vue'

// The tab store builds its module-scope Quickstart through a definition, so the
// registry must be populated before any import that evaluates it — including this
// composable, which imports the store. Static imports run before this file's body,
// hence the dynamic imports below.
import { registerWorkspaceDefinitions } from '../workspaces/registerDefinitions'
registerWorkspaceDefinitions()

const { tabs, activeTabId, activateTab, setRunRestoredTab } = await import('../stores/tabs')
const { useSessionPersistence } = await import('./useSessionPersistence')

vi.mock('../appApi/session', () => ({
  getOpenTabs: vi.fn(),
  setOpenTabs: vi.fn(() => Promise.resolve()),
}))
vi.mock('../engines/mongodb/api/connections', () => ({
  listConnections: vi.fn(() => Promise.resolve([{ id: 'c1' }, { id: 'c2' }])),
}))

const { getOpenTabs, setOpenTabs } = await import('../appApi/session')
const { listConnections } = await import('../engines/mongodb/api/connections')

const findTab = (id, connId = 'c1') => ({
  id, kind: 'collection', type: 'mongodb.find', engine: 'mongodb',
  title: 'orders', color: '#0f0',
  connectionId: connId, connectionName: 'Sales', dbName: 'shop', collectionName: 'orders',
  mode: 'find', filter: '{ "a": 1 }', sort: '{}', projection: '{}',
  skip: 0, limit: 25, pipeline: '', vqb: { rows: [1] }, colOrder: { a: 0 }, readOnly: false,
  results: [{ x: 1 }], hasRun: true, isRunning: false, runError: null,
  selectedRow: 0, selectedRows: [0], elapsedMs: 12,
})

function seedStore(arr, activeId) {
  tabs.value = arr
  activeTabId.value = activeId
}

let runRestoredTab
const autoSaves = []

beforeEach(() => {
  vi.clearAllMocks()
  runRestoredTab = vi.fn()
  // Activating a restored tab goes through the store's registered bridge; keep the
  // store and the composable on the same spy.
  setRunRestoredTab(runRestoredTab)
})

afterEach(() => {
  autoSaves.forEach(stop => stop())
  autoSaves.length = 0
  vi.useRealTimers()
})

describe('projection', () => {
  it('keeps the current projected session fixture unchanged', async () => {
    vi.useFakeTimers()
    const quickstart = { id: 't0', kind: 'quickstart', type: 'app.quickstart', title: 'Quickstart' }
    seedStore([findTab('f1'), quickstart], 'f1')
    const { startAutoSave } = useSessionPersistence({ runRestoredTab })
    autoSaves.push(startAutoSave())
    tabs.value = [...tabs.value, { ...findTab('f2'), title: 'products', collectionName: 'products' }]
    await nextTick()
    vi.advanceTimersByTime(400)
    expect(setOpenTabs).toHaveBeenCalledWith({
      activeTabId: 'f1',
      tabs: [
        {
          id: 'f1', kind: 'collection', title: 'orders', color: '#0f0',
          connectionId: 'c1', connectionName: 'Sales', dbName: 'shop', collectionName: 'orders',
          filter: '{ "a": 1 }', sort: '{}', projection: '{}', skip: 0, limit: 25,
          mode: 'find', pipeline: '', vqb: { rows: [1] }, readOnly: false, colOrder: { a: 0 },
        },
        {
          id: 'f2', kind: 'collection', title: 'products', color: '#0f0',
          connectionId: 'c1', connectionName: 'Sales', dbName: 'shop', collectionName: 'products',
          filter: '{ "a": 1 }', sort: '{}', projection: '{}', skip: 0, limit: 25,
          mode: 'find', pipeline: '', vqb: { rows: [1] }, readOnly: false, colOrder: { a: 0 },
        },
      ],
    })
  })

  it('excludes runtime fields from the persisted record', async () => {
    vi.useFakeTimers()
    seedStore([findTab('f1')], 'f1')
    const { startAutoSave } = useSessionPersistence({ runRestoredTab })
    autoSaves.push(startAutoSave())
    tabs.value = [...tabs.value, findTab('f2')]
    await nextTick()
    vi.advanceTimersByTime(400)
    const persisted = setOpenTabs.mock.calls[0][0]
    for (const tab of persisted.tabs) {
      expect(tab.results).toBeUndefined()
      expect(tab.hasRun).toBeUndefined()
      expect(tab.selectedRow).toBeUndefined()
      expect(tab.selectedRows).toBeUndefined()
      expect(tab.elapsedMs).toBeUndefined()
      expect(tab.type).toBeUndefined()
      expect(tab.engine).toBeUndefined()
    }
  })
})

describe('restoreSession', () => {
  it('drops workspaces whose connection was deleted', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    getOpenTabs.mockResolvedValue({
      activeTabId: 'r2',
      tabs: [findTab('r1', 'c1'), findTab('r2', 'c2'), findTab('r3', 'c3')],
    })
    listConnections.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }])
    const { restoreSession } = useSessionPersistence({ runRestoredTab })
    await restoreSession()
    const ids = tabs.value.map(t => t.id)
    expect(ids).toContain('r1')
    expect(ids).toContain('r2')
    expect(ids).not.toContain('r3')
  })

  it('does not restore ids that are already open', async () => {
    seedStore([findTab('r1'), { id: 't0', kind: 'quickstart', title: 'Quickstart' }], 'r1')
    getOpenTabs.mockResolvedValue({ activeTabId: 'r1', tabs: [findTab('r1'), findTab('r2')] })
    const { restoreSession } = useSessionPersistence({ runRestoredTab })
    await restoreSession()
    const ids = tabs.value.map(t => t.id)
    expect(ids.filter(id => id === 'r1')).toHaveLength(1)
    expect(ids).toContain('r2')
  })

  it('runs the active restored find through the bridge exactly once', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    getOpenTabs.mockResolvedValue({ activeTabId: 'r1', tabs: [findTab('r1')] })
    const { restoreSession } = useSessionPersistence({ runRestoredTab })
    await restoreSession()
    expect(runRestoredTab).toHaveBeenCalledTimes(1)
    expect(runRestoredTab.mock.calls[0][0].id).toBe('r1')
    await restoreSession() // a second restore must not re-run it
    expect(runRestoredTab).toHaveBeenCalledTimes(1)
  })

  it('leaves an inactive restored find waiting for activation', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    getOpenTabs.mockResolvedValue({ activeTabId: 't0', tabs: [findTab('r1')] })
    const { restoreSession } = useSessionPersistence({ runRestoredTab })
    await restoreSession()
    expect(runRestoredTab).not.toHaveBeenCalled()
    activateTab('r1')
    expect(runRestoredTab).toHaveBeenCalledTimes(1)
  })

  it('does not auto-run restored aggregate or sql tabs', async () => {
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    const aggregate = {
      ...findTab('a'), type: 'mongodb.aggregate', mode: 'aggregate',
      pipeline: '[{ "$match": {} }]', filter: '', projection: '', sort: '', skip: 0,
    }
    const sql = { ...findTab('s'), type: 'mongodb.sql_to_mql', mode: 'sql', sql: 'SELECT 1' }
    getOpenTabs.mockResolvedValue({ activeTabId: 'a', tabs: [aggregate, sql] })
    const { restoreSession } = useSessionPersistence({ runRestoredTab })
    await restoreSession()
    expect(runRestoredTab).not.toHaveBeenCalled()
    const agg = tabs.value.find(t => t.id === 'a')
    const sq = tabs.value.find(t => t.id === 's')
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
    const { restoreSession } = useSessionPersistence({ runRestoredTab })
    await restoreSession()
    const shell = tabs.value.find(t => t.id === 'sh')
    expect(shell.sessionId).not.toBe('old-session')
    expect(shell.code).toBe('db.orders.find()')
  })

  it('skips autosave after a failed restore so the truncated state never persists', async () => {
    vi.useFakeTimers()
    seedStore([{ id: 't0', kind: 'quickstart', title: 'Quickstart' }], 't0')
    getOpenTabs.mockRejectedValue(new Error('corrupt file'))
    const { restoreSession, startAutoSave } = useSessionPersistence({ runRestoredTab })
    await restoreSession()
    autoSaves.push(startAutoSave())
    tabs.value = [...tabs.value, findTab('f1')]
    await nextTick()
    vi.advanceTimersByTime(400)
    expect(setOpenTabs).not.toHaveBeenCalled()
  })
})