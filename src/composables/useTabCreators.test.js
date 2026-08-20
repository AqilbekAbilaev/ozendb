import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

// Definitions must be registered before the tab store can build its Quickstart tab
// (stores/tabs.js creates it through createWorkspace, see initializeTabs). Static
// imports evaluate before this module's body, so the store — and everything importing
// it — is loaded dynamically after the one-time registration.
import { registerWorkspaceDefinitions } from '../workspaces/registerDefinitions'
registerWorkspaceDefinitions()

const { useTabCreators } = await import('./useTabCreators')
const { tabs, activeTabId } = await import('../stores/tabs')
const { getDefaultQuery } = await import('../engines/mongodb/api/queryLibrary')

vi.mock('../engines/mongodb/api/queryLibrary', () => ({
  getDefaultQuery: vi.fn(),
}))

// Each test seeds a clean tab strip; the creators append to it. The query runner and
// the modal API are fakes so no Tauri call can leak into the assertions.
function harness() {
  tabs.value = [{ id: 't0', kind: 'quickstart', title: 'Quickstart' }]
  activeTabId.value = 't0'
  const runQuery = vi.fn()
  const modalsApi = { openModal: vi.fn() }
  const defaultQueryLimit = { value: 50 }
  const defaultResultView = { value: 'table' }
  const creators = useTabCreators({
    defaultQueryLimit,
    defaultResultView,
    runQuery,
    modalsApi,
    showToast: vi.fn(),
  })
  return { ...creators, runQuery, modalsApi, defaultQueryLimit, defaultResultView }
}

const COLLECTION = { connectionId: 'c1', connectionName: 'Sales', dbName: 'shop', collectionName: 'orders' }
const NODE = { connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders' }
const DB_NODE = { connId: 'c1', connName: 'Sales', dbName: 'shop' }
const CONN_NODE = { connId: 'c1', connName: 'Sales' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getDefaultQuery).mockResolvedValue(null)
})

const lastTab = () => tabs.value[tabs.value.length - 1]
const ids = () => tabs.value.map(t => t.id)

describe('open policies — every open makes its own tab', () => {
  it('opens collections, shells, current-operations, imports, and exports without dedup', () => {
    const c = harness()
    c.openCollectionTab(COLLECTION)
    c.openCollectionTab(COLLECTION)
    c.openShellTab(DB_NODE)
    c.openShellTab(DB_NODE)
    c.openCurrentOpsTab(CONN_NODE)
    c.openCurrentOpsTab(CONN_NODE)
    c.openImportTab(NODE, 'csv')
    c.openImportTab(NODE, 'csv')
    c.openExportTab({ ...NODE, query: null, selectedIds: [] }, 'collection')
    c.openExportTab({ ...NODE, query: null, selectedIds: [] }, 'collection')
    expect(tabs.value).toHaveLength(11) // the seeded Quickstart plus ten opens
  })

  it('activates every newly opened tab', () => {
    const c = harness()
    c.openCollectionTab(COLLECTION)
    c.openShellTab(DB_NODE)
    c.openCurrentOpsTab(CONN_NODE)
    c.openImportTab(NODE, 'json')
    expect(activeTabId.value).toBe(lastTab().id)
  })
})

describe('focus policies — one tab per target', () => {
  it('focuses the existing SQL tab for the same collection instead of opening', () => {
    const c = harness()
    c.openSqlTab(COLLECTION)
    const sqlTab = lastTab()
    c.openSqlTab(COLLECTION)
    expect(tabs.value).toHaveLength(2)
    expect(activeTabId.value).toBe(sqlTab.id)
  })

  it('focuses the existing Index Manager tab for the same collection', () => {
    const c = harness()
    c.openIndexManagerTab(NODE)
    const idxTab = lastTab()
    c.openIndexManagerTab(NODE)
    expect(tabs.value).toHaveLength(2)
    expect(activeTabId.value).toBe(idxTab.id)
  })

  it('focuses the existing Schema tab for the same collection', () => {
    const c = harness()
    c.openSchemaTab(NODE)
    const schemaTab = lastTab()
    c.openSchemaTab(NODE)
    expect(tabs.value).toHaveLength(2)
    expect(activeTabId.value).toBe(schemaTab.id)
  })

  it('focuses the existing Search tab for the same database', () => {
    const c = harness()
    c.openSearchTab(DB_NODE)
    const searchTab = lastTab()
    c.openSearchTab(DB_NODE)
    expect(tabs.value).toHaveLength(2)
    expect(activeTabId.value).toBe(searchTab.id)
  })

  it('focuses the existing Quickstart instead of stacking', () => {
    const c = harness()
    c.openQuickstart()
    expect(tabs.value).toHaveLength(1)
    expect(activeTabId.value).toBe('t0')
  })

  it('reopens Quickstart when it was closed', () => {
    const c = harness()
    tabs.value = []
    c.openQuickstart()
    expect(tabs.value).toHaveLength(1)
    expect(lastTab().kind).toBe('quickstart')
    expect(activeTabId.value).toBe(lastTab().id)
  })
})

describe('created tab shapes', () => {
  it('builds collection tabs through their definition with the app defaults', () => {
    const c = harness()
    c.openCollectionTab(COLLECTION)
    const tab = lastTab()
    expect(tab.type).toBe('mongodb.find')
    expect(tab.engine).toBe('mongodb')
    expect(tab.kind).toBe('collection')
    expect(tab.mode).toBe('find')
    expect(tab.limit).toBe(50)
    expect(tab.resultView).toBe('table')
    expect(tab.title).toBe('orders')
    expect(tab.connectionId).toBe('c1')
  })

  it('opens aggregate tabs in aggregate mode with an empty pipeline', () => {
    const c = harness()
    c.openCollectionTab(COLLECTION, 'aggregate')
    expect(lastTab().type).toBe('mongodb.aggregate')
    expect(lastTab().mode).toBe('aggregate')
    expect(lastTab().pipeline).toBe('')
  })

  it('opens SQL tabs with the seeded editor text', () => {
    const c = harness()
    c.openSqlTab(COLLECTION)
    expect(lastTab().type).toBe('mongodb.sql_to_mql')
    expect(lastTab().sql).toBe('SELECT *\nFROM orders')
    expect(lastTab().mode).toBe('sql')
  })

  it('gives every shell tab its own engine session', () => {
    const c = harness()
    c.openShellTab(DB_NODE)
    const s1 = lastTab()
    c.openShellTab(DB_NODE)
    const s2 = lastTab()
    expect(s1.sessionId).not.toBe(s2.sessionId)
    expect(s1.title).toBe('mongosh: shop')
  })

  it('opens current-operations tabs with the toolbar defaults on the tab', () => {
    const c = harness()
    c.openCurrentOpsTab(CONN_NODE)
    expect(lastTab().kind).toBe('currentOps')
    expect(lastTab().frequency).toBe(2000)
    expect(lastTab().title).toBe('Current Operations: Sales')
  })

  it('opens imports with the chosen format', () => {
    const c = harness()
    c.openImportTab(NODE, 'csv')
    expect(lastTab().format).toBe('csv')
    expect(lastTab().subTab).toBe('source')
    c.openImportTab(NODE, 'json')
    expect(lastTab().format).toBe('json')
    expect(lastTab().sources).toEqual([])
  })

  it('opens exports with the source frozen at creation', () => {
    const c = harness()
    c.openExportTab({ ...NODE, query: '{ "a": 1 }', selectedIds: ['x', 'y'] }, 'query')
    const tab = lastTab()
    expect(tab.kind).toBe('export')
    expect(tab.source).toBe('query')
    expect(tab.filter).toBe('{ "a": 1 }')
    expect(tab.sourceCount).toBe(null)
    expect(tab.title).toBe('Export: orders (query)')
  })
})

describe('initial query execution', () => {
  it('runs a supplied filter immediately, bypassing default-query loading', async () => {
    const c = harness()
    await c.openCollectionTab({ ...COLLECTION, filter: '{ "status": "open" }' })
    expect(getDefaultQuery).not.toHaveBeenCalled()
    expect(c.runQuery).toHaveBeenCalledTimes(1)
    expect(c.runQuery).toHaveBeenCalledWith(lastTab().id, {
      filter: '{"status":"open"}', projection: '{}', sort: '{}', skip: 0, limit: 50,
    })
  })

  it('keeps the supplied filter text on the tab so the editor, history, and session agree', async () => {
    const c = harness()
    const filter = '{ "status": "open" }'
    await c.openCollectionTab({ ...COLLECTION, filter })
    expect(lastTab().filter).toBe(filter) // exact text, not the parsed EJSON sent to the API
  })

  it('keeps invalid filter text visible while falling back to an empty query', async () => {
    const c = harness()
    await c.openCollectionTab({ ...COLLECTION, filter: 'not json' })
    expect(lastTab().filter).toBe('not json')
    expect(c.runQuery).toHaveBeenCalledWith(lastTab().id, {
      filter: '{}', projection: '{}', sort: '{}', skip: 0, limit: 50,
    })
  })

  it('loads and runs the saved default query on open', async () => {
    vi.mocked(getDefaultQuery).mockResolvedValue({
      filter: '{ "x": 1 }', sort: '{ "y": -1 }', projection: '{ "z": 1 }', skip: 2, limit: 5,
    })
    const c = harness()
    await c.openCollectionTab(COLLECTION)
    expect(getDefaultQuery).toHaveBeenCalledWith({ connectionId: 'c1', database: 'shop', collection: 'orders' })
    const tab = lastTab()
    expect(tab.filter).toBe('{ "x": 1 }')
    expect(tab.limit).toBe(5)
    expect(c.runQuery).toHaveBeenCalledWith(tab.id, {
      filter: '{"x":{"$numberInt":"1"}}', sort: '{"y":{"$numberInt":"-1"}}',
      projection: '{"z":{"$numberInt":"1"}}', skip: 2, limit: 5,
    })
  })

  it('falls back to the empty-query run when default-query loading fails', async () => {
    vi.mocked(getDefaultQuery).mockRejectedValue(new Error('boom'))
    const c = harness()
    await c.openCollectionTab(COLLECTION)
    expect(c.runQuery).toHaveBeenCalledWith(lastTab().id, {
      filter: '{}', projection: '{}', sort: '{}', skip: 0, limit: 50,
    })
  })

  it('runs the empty-query fallback when there is no saved default query', async () => {
    const c = harness()
    await c.openCollectionTab(COLLECTION)
    expect(c.runQuery).toHaveBeenCalledWith(lastTab().id, {
      filter: '{}', projection: '{}', sort: '{}', skip: 0, limit: 50,
    })
  })

  it('does not run anything on open for aggregate or SQL tabs', async () => {
    const c = harness()
    await c.openCollectionTab(COLLECTION, 'aggregate')
    c.openSqlTab(COLLECTION)
    expect(c.runQuery).not.toHaveBeenCalled()
  })
})

describe('export source resolution', () => {
  it('starts in the export-source modal with the resolved query and selected ids', () => {
    const c = harness()
    tabs.value = [{
      id: 't1', kind: 'collection', connectionId: 'c1', dbName: 'shop', collectionName: 'orders',
      filter: '{ "status": "open" }', results: [{ _id: 'a' }, { _id: 'b' }, { noId: true }],
      selectedRows: [0, 1, 2],
    }]
    c.openExportSource(NODE)
    expect(c.modalsApi.openModal).toHaveBeenCalledWith('exportSource', {
      ...NODE,
      query: '{"status":"open"}',
      selectedIds: ['a', 'b'],
    })
  })
})

describe('changed settings affect only future workspaces', () => {
  it('applies a new query limit to tabs opened after the setting changes', () => {
    const c = harness()
    c.openCollectionTab(COLLECTION)
    expect(lastTab().limit).toBe(50)
    c.defaultQueryLimit.value = 100
    c.openCollectionTab(COLLECTION)
    expect(lastTab().limit).toBe(100)
    expect(tabs.value[1].limit).toBe(50)
  })
})

describe('ids', () => {
  it('gives distinct ids to tabs opened in one tick', () => {
    const c = harness()
    c.openCollectionTab(COLLECTION)
    c.openShellTab(DB_NODE)
    c.openCurrentOpsTab(CONN_NODE)
    expect(new Set(ids()).size).toBe(4)
  })
})