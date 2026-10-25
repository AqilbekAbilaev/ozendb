import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'

vi.mock('../../../appApi/session', () => ({ getOpenTabs: vi.fn(), setOpenTabs: vi.fn() }))
vi.mock('../../../appApi/connections', () => ({ listConnections: vi.fn() }))
vi.mock('../../../appApi/errorLog', () => ({ recordFrontendError: vi.fn(() => Promise.resolve()) }))
vi.mock('../../../stores/toast', () => ({ showToast: vi.fn() }))
vi.mock('../api/queries', async (original) => ({ ...(await original()), runQuery: vi.fn() }))
vi.mock('../../sql/api/library', () => ({ pushHistory: vi.fn(() => Promise.resolve()) }))

// The registry must be filled before the tab store, which builds tabs, is evaluated.
const { registerWorkspaceDefinitions } = await import('../../../workspaces/registerDefinitions.js')
registerWorkspaceDefinitions()
const { tabs, activeTabId, activateTab } = await import('../../../stores/tabs.js')
const { useSessionPersistence } = await import('../../../composables/useSessionPersistence.js')
const { createWorkspace } = await import('../../../workspaces/createWorkspace.js')
const { createResourceRef } = await import('../../../utils/resourceRef')
const { runSql } = await import('../../sql/workspaces/runSql.js')
const { getOpenTabs, setOpenTabs } = await import('../../../appApi/session')
const { listConnections } = await import('../../../appApi/connections')
const { runQuery } = await import('../api/queries')

const database = { kind: 'database', name: 'shop `2024` ü' }
const open = (type, connectionId, segments) =>
  createWorkspace(type, { target: { resource: createResourceRef(connectionId, segments), connectionName: 'local' } })

// What the session writes once these tabs open, through its own autosave.
async function savedSession(opened) {
  vi.useFakeTimers()
  const session = useSessionPersistence()
  getOpenTabs.mockResolvedValue(null)
  await session.initializeSession({ restore: false })
  const stop = session.startAutoSave()
  tabs.value = opened
  await nextTick()
  vi.advanceTimersByTime(400)
  stop()
  vi.useRealTimers()
  return setOpenTabs.mock.calls.at(-1)[0]
}

// A fresh launch reading that session back.
async function relaunch(session) {
  tabs.value = []
  getOpenTabs.mockResolvedValue(session)
  await useSessionPersistence().initializeSession({ restore: true })
  return tabs.value
}

beforeEach(() => {
  vi.clearAllMocks()
  setOpenTabs.mockResolvedValue(undefined)
  listConnections.mockResolvedValue([{ id: 'c1', name: 'local' }])
  tabs.value = []
  activeTabId.value = null
})

afterEach(() => vi.useRealTimers())

describe('MySQL tabs across a restart', () => {
  it('brings back a table tab and SQL tabs with and without a database, as they were', async () => {
    const table = open('mysql.table_browse', 'c1', [database, { kind: 'table', name: 'order items' }])
    const inDatabase = open('mysql.query', 'c1', [database])
    const onConnection = open('mysql.query', 'c1', [])
    inDatabase.state.sql = 'SELECT `ü` FROM `order items`'
    onConnection.state.sql = 'SHOW DATABASES'
    const [restoredTable, restoredInDatabase, restoredOnConnection] = await relaunch(await savedSession([table, inDatabase, onConnection]))
    expect(restoredTable).toMatchObject({ id: table.id, type: 'mysql.table_browse', title: 'order items', target: table.target })
    expect(restoredInDatabase).toMatchObject({ id: inDatabase.id, title: 'SQL: shop `2024` ü', target: inDatabase.target, state: { sql: 'SELECT `ü` FROM `order items`' } })
    expect(restoredInDatabase.runtime.run.database).toBe('shop `2024` ü')
    expect(restoredOnConnection).toMatchObject({ id: onConnection.id, title: 'SQL: local', target: onConnection.target, state: { sql: 'SHOW DATABASES' } })
    expect(restoredOnConnection.runtime.run.database).toBe(null)
  })

  it('leaves out a tab whose connection was deleted', async () => {
    const session = await savedSession([open('mysql.query', 'c1', [database]), open('mysql.query', 'gone', [database])])
    expect(session.tabs).toHaveLength(2)
    expect((await relaunch(session)).map(tab => tab.target.connectionId)).toEqual(['c1'])
  })
})

describe('switching away from a MySQL SQL tab and back', () => {
  it('keeps its SQL and its last result', async () => {
    const query = open('mysql.query', 'c1', [database])
    const other = open('mysql.query', 'c1', [])
    tabs.value = [query, other]
    activateTab(query.id)
    const result = { columns: ['ü'], rows: [[1]], truncated: false, elapsedMs: 1, rowsAffected: null }
    runQuery.mockResolvedValue(result)
    query.state.sql = 'SELECT 1 AS `ü`'
    await runSql(query.runtime.run, query.state.sql)
    activateTab(other.id)
    activateTab(query.id)
    const shown = tabs.value.find(tab => tab.id === activeTabId.value)
    expect(shown.state.sql).toBe('SELECT 1 AS `ü`')
    expect(shown.runtime.run.result).toEqual(result)
  })
})
