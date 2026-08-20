import { describe, it, expect, beforeEach, vi } from 'vitest'

// The store's module-scope Quickstart is built through its workspace definition, so
// definitions must be registered before this module evaluates. Static imports run
// before this file's body, hence the dynamic import below.
import { registerWorkspaceDefinitions } from '../workspaces/registerDefinitions'
registerWorkspaceDefinitions()

const {
  tabs, activeTabId, activeTab, pruneActiveTab, setRunRestoredTab,
  activateTab, cycleTab, closeTab, closeWhere, duplicateTab, handleTabAction, newTabId,
  initializeTabs,
} = await import('./tabs')

// Closing a shell tab tears down its engine session; that call is the one side effect
// in here worth asserting, so the driver is stubbed rather than the test avoiding it.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))
const { invoke } = await import('@tauri-apps/api/core')

// Pins the tab-mutation behaviour most at risk from a refactor: which tab becomes active
// after a close, and the bulk closers staying correct while closeTab splices the array
// under them.
//
// App.vue registers the real re-runner during setup; here it's a spy.
const runRestoredTab = vi.fn()
setRunRestoredTab(runRestoredTab)

// The store's refs are module-scope singletons, so each test seeds them explicitly.
function seed(ids, activeId) {
  tabs.value = ids.map(id => (typeof id === 'string' ? { id, kind: 'collection' } : id))
  activeTabId.value = activeId
}
const idsOf = () => tabs.value.map(t => t.id)

// The store no longer seeds itself at module scope (see the ordering contract in
// tabs.js): initializeTabs(), called by main.js after registration, establishes the
// first tab. Asserted before any test reseeds the ref.
describe('initializeTabs', () => {
  it('creates a Quickstart through its definition with the stable t0 id', () => {
    initializeTabs()
    expect(tabs.value).toHaveLength(1)
    const t = tabs.value[0]
    expect(t.id).toBe('t0')
    expect(t.kind).toBe('quickstart')
    expect(t.title).toBe('Quickstart')
    expect(t.type).toBe('app.quickstart')
    expect(t.engine).toBe('app')
    expect(activeTabId.value).toBe('t0')
  })

  it('is a no-op once already initialized', () => {
    initializeTabs()
    initializeTabs()
    expect(tabs.value).toHaveLength(1)
    expect(activeTabId.value).toBe('t0')
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('closeTab — which tab becomes active', () => {
  it('leaves the active tab alone when closing a different one', () => {
    seed(['a', 'b', 'c'], 'a')
    closeTab('c')
    expect(idsOf()).toEqual(['a', 'b'])
    expect(activeTabId.value).toBe('a')
  })

  // Seeded four deep with the third active on purpose: with only three tabs the
  // preceding tab and the first tab are the same one, so the assertion couldn't tell
  // "nearest preceding" from "always fall back to first".
  it('falls back to the nearest preceding tab when closing the active one', () => {
    seed(['a', 'b', 'c', 'd'], 'c')
    closeTab('c')
    expect(idsOf()).toEqual(['a', 'b', 'd'])
    expect(activeTabId.value).toBe('b')
  })

  it('falls back to the new first tab when closing the active leftmost tab', () => {
    seed(['a', 'b', 'c'], 'a')
    closeTab('a')
    expect(idsOf()).toEqual(['b', 'c'])
    expect(activeTabId.value).toBe('b')
  })

  it('clears the active id when the last tab closes', () => {
    seed(['a'], 'a')
    closeTab('a')
    expect(idsOf()).toEqual([])
    expect(activeTabId.value).toBe(null)
  })

  it('ignores an unknown tab id', () => {
    seed(['a', 'b'], 'a')
    closeTab('nope')
    expect(idsOf()).toEqual(['a', 'b'])
    expect(activeTabId.value).toBe('a')
  })
})

describe('closeTab — shell session teardown', () => {
  it('closes the engine session behind a shell tab', () => {
    seed([{ id: 's1', kind: 'shell', type: 'mongodb.shell', sessionId: 'sess-1' }, 'b'], 'b')
    closeTab('s1')
    expect(invoke).toHaveBeenCalledWith('close_shell_session', { sessionId: 'sess-1' })
  })

  it('does not call the driver for a shell tab that never opened a session', () => {
    seed([{ id: 's1', kind: 'shell', type: 'mongodb.shell', sessionId: null }, 'b'], 'b')
    closeTab('s1')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('does not call the driver for a collection tab', () => {
    seed(['a', 'b'], 'a')
    closeTab('a')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('keeps the removal synchronous while disposal runs in the background', () => {
    seed([{ id: 's1', kind: 'shell', type: 'mongodb.shell', sessionId: 'sess-1' }, 'b'], 's1')
    closeTab('s1')
    expect(idsOf()).toEqual(['b'])
  })

  it('does not block removal when disposal rejects', () => {
    invoke.mockRejectedValueOnce(new Error('session gone'))
    seed([{ id: 's1', kind: 'shell', type: 'mongodb.shell', sessionId: 'sess-1' }, 'b'], 's1')
    expect(() => closeTab('s1')).not.toThrow()
    expect(idsOf()).toEqual(['b'])
  })
})

// closeTab splices, so every index shifts mid-iteration. filter/slice hand back a fresh
// array which is what keeps these correct; iterating the live array skips alternate tabs.
describe('bulk close — iterating while the array reindexes', () => {
  it('closes every tab to the left of the target', () => {
    seed(['a', 'b', 'c', 'd', 'e'], 'e')
    handleTabAction('Close Tabs to the Left', 'd')
    expect(idsOf()).toEqual(['d', 'e'])
  })

  it('closes every tab to the right of the target', () => {
    seed(['a', 'b', 'c', 'd', 'e'], 'a')
    handleTabAction('Close Tabs to the Right', 'b')
    expect(idsOf()).toEqual(['a', 'b'])
  })

  it('keeps only the target tab and makes it active', () => {
    seed(['a', 'b', 'c', 'd'], 'a')
    handleTabAction('Close Other Tabs', 'c')
    expect(idsOf()).toEqual(['c'])
    expect(activeTabId.value).toBe('c')
  })

  it('closes all tabs', () => {
    seed(['a', 'b', 'c'], 'b')
    handleTabAction('Close All Tabs', 'b')
    expect(idsOf()).toEqual([])
  })

  it('ignores a side-close against an unknown tab id', () => {
    seed(['a', 'b'], 'a')
    handleTabAction('Close Tabs to the Left', 'nope')
    expect(idsOf()).toEqual(['a', 'b'])
  })
})

describe('cycleTab', () => {
  it('moves to the next tab', () => {
    seed(['a', 'b', 'c'], 'a')
    cycleTab(1)
    expect(activeTabId.value).toBe('b')
  })

  it('wraps past the last tab', () => {
    seed(['a', 'b', 'c'], 'c')
    cycleTab(1)
    expect(activeTabId.value).toBe('a')
  })

  it('wraps backwards past the first tab', () => {
    seed(['a', 'b', 'c'], 'a')
    cycleTab(-1)
    expect(activeTabId.value).toBe('c')
  })

  it('does nothing with fewer than two tabs', () => {
    seed(['a'], 'a')
    cycleTab(1)
    expect(activeTabId.value).toBe('a')
  })

  it('activates the first tab when the active id is stale', () => {
    seed(['a', 'b'], 'gone')
    cycleTab(1)
    expect(activeTabId.value).toBe('a')
  })
})

// Callers that bulk-remove tabs (disconnecting, dropping a database or collection) filter
// the array themselves and then call this to repair the active id. Three copies of this
// logic used to live in useFeatures and useDbActions.
describe('pruneActiveTab', () => {
  it('leaves a still-open active tab alone', () => {
    seed(['a', 'b', 'c'], 'b')
    pruneActiveTab()
    expect(activeTabId.value).toBe('b')
  })

  it('falls back to the last remaining tab when the active one is gone', () => {
    seed(['a', 'b', 'c'], 'b')
    tabs.value = tabs.value.filter(t => t.id !== 'b')
    pruneActiveTab()
    expect(activeTabId.value).toBe('c')
  })

  it('clears the active id when every tab is gone', () => {
    seed(['a', 'b'], 'a')
    tabs.value = []
    pruneActiveTab()
    expect(activeTabId.value).toBe(null)
  })

  it('does nothing when there is no active tab to repair', () => {
    seed(['a'], null)
    pruneActiveTab()
    expect(activeTabId.value).toBe(null)
  })
})

describe('activeTab', () => {
  it('resolves the active id to its tab', () => {
    seed(['a', 'b'], 'b')
    expect(activeTab.value.id).toBe('b')
  })

  it('is undefined when the active id matches nothing', () => {
    seed(['a', 'b'], 'gone')
    expect(activeTab.value).toBeUndefined()
  })

  it('tracks the active id changing', () => {
    seed(['a', 'b'], 'a')
    activeTabId.value = 'b'
    expect(activeTab.value.id).toBe('b')
  })
})

// Re-activating a restored tab re-runs its saved query; that hand-off is why the store
// takes a registered re-runner rather than importing the query runner.
describe('activateTab', () => {
  it('re-runs a restored tab when it is activated', () => {
    const restored = { id: 'r', kind: 'collection', _restored: true }
    seed([restored, 'b'], 'b')
    activateTab('r')
    expect(activeTabId.value).toBe('r')
    expect(runRestoredTab).toHaveBeenCalledWith(restored)
  })

  it('does not re-run a tab that was never restored', () => {
    seed(['a', 'b'], 'b')
    activateTab('a')
    expect(runRestoredTab).not.toHaveBeenCalled()
  })
})

const FIND_TAB = {
  id: 'f1', kind: 'collection', type: 'mongodb.find', engine: 'mongodb',
  title: 'orders', color: '#f00',
  connectionId: 'c1', connectionName: 'Sales', dbName: 'shop', collectionName: 'orders',
  mode: 'find', filter: '{ "a": 1 }', projection: '{}', sort: '{}',
  skip: 0, limit: 25, pipeline: '', vqb: { rows: [1] }, colOrder: { a: 0 },
  results: [{ x: 1 }], hasRun: true, isRunning: false, runError: null,
  selectedRow: 0, selectedRows: [0], elapsedMs: 12,
}

describe('duplicateTab', () => {
  it('appends the duplicate and activates it', () => {
    seed([FIND_TAB, 'b'], 'b')
    duplicateTab('f1')
    expect(tabs.value).toHaveLength(3)
    expect(activeTabId.value).toBe(tabs.value[2].id)
    expect(tabs.value[2].id).not.toBe('f1')
    expect(tabs.value[2].filter).toBe('{ "a": 1 }')
    expect(tabs.value[2].results).toEqual([])
  })

  it('re-runs a duplicated find through the existing bridge exactly once', () => {
    seed([FIND_TAB, 'b'], 'b')
    duplicateTab('f1')
    expect(runRestoredTab).toHaveBeenCalledTimes(1)
    expect(runRestoredTab).toHaveBeenCalledWith(tabs.value[2])
  })

  it('does not re-run duplicated aggregate or sql tabs', () => {
    seed([{ ...FIND_TAB, id: 'a', type: 'mongodb.aggregate', mode: 'aggregate', pipeline: '[{}]' }, 'b'], 'b')
    duplicateTab('a')
    expect(runRestoredTab).not.toHaveBeenCalled()
    expect(tabs.value[2].mode).toBe('aggregate')
    seed([{ ...FIND_TAB, id: 's', type: 'mongodb.sql_to_mql', mode: 'sql', sql: 'SELECT 1' }, 'b'], 'b')
    duplicateTab('s')
    expect(runRestoredTab).not.toHaveBeenCalled()
    expect(tabs.value[2].sql).toBe('SELECT 1')
  })

  it('is a no-op for an unsupported duplicate', () => {
    seed([{ id: 'q', kind: 'quickstart', type: 'app.quickstart', title: 'Quickstart' }, 'b'], 'q')
    duplicateTab('q')
    expect(tabs.value).toHaveLength(2)
    expect(activeTabId.value).toBe('q')
  })

  it('keeps a duplicated shell a shell with a fresh session', () => {
    seed([{
      id: 's1', kind: 'shell', type: 'mongodb.shell', engine: 'mongodb', title: 'mongosh: shop',
      connectionId: 'c1', connectionName: 'Sales', dbName: 'shop',
      sessionId: 'old-session', code: 'db.x.find()', history: [], isRunning: false,
      results: [], resultView: 'table', resultTab: 'Console',
      runError: null, elapsedMs: null, drillPath: [], hasRun: false,
      selectedRow: -1, selectedRows: [], logs: [], scalar: undefined, hasScalar: false,
    }, 'b'], 'b')
    duplicateTab('s1')
    const dup = tabs.value[2]
    expect(dup.kind).toBe('shell')
    expect(dup.sessionId).not.toBe('old-session')
    expect(dup.code).toBe('db.x.find()')
    expect(dup.history).toEqual([])
  })

  it('a tool workspace can never become a collection workspace', () => {
    seed([{
      id: 'i', kind: 'indexes', type: 'mongodb.indexes', engine: 'mongodb',
      title: 'Index Manager: orders', connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders',
    }, 'b'], 'b')
    duplicateTab('i')
    const dup = tabs.value[2]
    expect(dup.kind).toBe('indexes')
    expect(dup.type).toBe('mongodb.indexes')
    expect(dup.mode).toBeUndefined()
    expect(dup.connectionId).toBeUndefined()
  })
})

describe('closeWhere', () => {
  const shellTab = { id: 's1', kind: 'shell', type: 'mongodb.shell', sessionId: 'sess-1' }

  it('closes every tab matching the predicate', () => {
    seed([shellTab, 'b', 'c'], 'c')
    closeWhere(t => t.kind === 'shell')
    expect(idsOf()).toEqual(['b', 'c'])
    expect(activeTabId.value).toBe('c')
  })

  it('disposes once per removed workspace', () => {
    seed([shellTab, { ...shellTab, id: 's2', sessionId: 'sess-2' }, 'b'], 'b')
    closeWhere(t => t.kind === 'shell')
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(invoke).toHaveBeenCalledWith('close_shell_session', { sessionId: 'sess-1' })
    expect(invoke).toHaveBeenCalledWith('close_shell_session', { sessionId: 'sess-2' })
  })

  it('keeps every matching tab while splicing', () => {
    seed(['a', shellTab, 'b', { ...shellTab, id: 's3', sessionId: 'sess-3' }, 'c'], 'c')
    closeWhere(t => t.kind === 'shell')
    expect(idsOf()).toEqual(['a', 'b', 'c'])
  })

  it('leaves the array untouched when nothing matches', () => {
    seed(['a', 'b'], 'a')
    closeWhere(t => t.kind === 'shell')
    expect(idsOf()).toEqual(['a', 'b'])
  })
})

// Tab ids used to be 't' + Date.now(), so two tabs opened in the same millisecond —
// which happens when several are created programmatically — shared an id. Duplicate
// ids make closeTab/activateTab hit whichever copy comes first.
describe('newTabId', () => {
  it('gives every tab a distinct id even when created in one tick', () => {
    const ids = new Set(Array.from({ length: 1000 }, newTabId))
    expect(ids.size).toBe(1000)
  })
})
