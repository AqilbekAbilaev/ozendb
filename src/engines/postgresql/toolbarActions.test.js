import { describe, it, expect, vi, beforeEach } from 'vitest'

const openPostgresQuery = vi.fn()
const openPostgresTable = vi.fn()
const openPostgresSearch = vi.fn()
vi.mock('./tabs', () => ({ openPostgresQuery, openPostgresTable, openPostgresSearch }))
const openModal = vi.fn()
vi.mock('../../stores/modals', () => ({ openModal }))
const showToast = vi.fn()
vi.mock('../../stores/toast', () => ({ showToast }))
const treeSelection = { value: null }
vi.mock('../../stores/connectionNavigation', () => ({ treeSelection }))
const activeTab = { value: null }
vi.mock('../../stores/tabs', () => ({ activeTab }))

const { runPgTool } = await import('./toolbarActions.js')

const table = {
  connId: 'p1', engine: 'postgresql', connName: 'Payments PG', connectionId: 'p1', connectionName: 'Payments PG',
  database: 'payments', schema: 'public', table: 'merchants',
}
// A table highlighted in the sidebar, as the PostgreSQL tree stores it.
const selectedTable = {
  engine: 'postgresql', connectionId: 'p1', connectionName: 'Payments PG',
  database: 'payments', schema: 'public', table: 'merchants',
  resource: { connectionId: 'p1', segments: [
    { kind: 'database', name: 'payments' }, { kind: 'schema', name: 'public' }, { kind: 'table', name: 'merchants' },
  ] },
}
const selectedSchema = {
  ...selectedTable, table: null,
  resource: { connectionId: 'p1', segments: selectedTable.resource.segments.slice(0, 2) },
}
// The table tab open on that table, as its definition builds it.
const tableTab = { id: 't1', type: 'postgresql.table_browse', connectionName: 'Payments PG', target: selectedTable.resource }

beforeEach(() => {
  vi.clearAllMocks()
  treeSelection.value = null
  activeTab.value = null
})

describe('runPgTool', () => {
  it("leaves every other tool to the MongoDB dispatcher", () => {
    treeSelection.value = selectedTable
    expect(runPgTool('collection')).toBe(false)
    expect(openPostgresTable).not.toHaveBeenCalled()
  })

  it('opens the table selected in the sidebar', () => {
    treeSelection.value = selectedTable
    expect(runPgTool('pgTable')).toBe(true)
    expect(openPostgresTable).toHaveBeenCalledWith({
      connectionId: 'p1', connectionName: 'Payments PG', database: 'payments', schema: 'public', table: 'merchants',
    })
  })

  it("doesn't reopen the active table tab when nothing is selected in the sidebar", () => {
    activeTab.value = tableTab
    expect(runPgTool('pgTable')).toBe(true)
    expect(openPostgresTable).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Select a PostgreSQL table in the sidebar first')
  })

  it('opens a SQL tab on the database in focus', () => {
    treeSelection.value = selectedSchema
    runPgTool('pgSql')
    expect(openPostgresQuery).toHaveBeenCalledWith({ connectionId: 'p1', connectionName: 'Payments PG', database: 'payments' })
  })

  it('opens Search in Schema on the schema in focus', () => {
    treeSelection.value = selectedSchema
    runPgTool('pgSearch')
    expect(openPostgresSearch).toHaveBeenCalledWith({ connectionId: 'p1', connectionName: 'Payments PG', database: 'payments', schema: 'public' })
  })

  it('asks for a table when only a schema is in focus', () => {
    treeSelection.value = selectedSchema
    runPgTool('pgExport')
    expect(openModal).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Select a PostgreSQL table first')
  })

  it('opens export and import on the table in focus', () => {
    activeTab.value = tableTab
    runPgTool('pgExport')
    runPgTool('pgImport')
    expect(openModal).toHaveBeenNthCalledWith(1, 'sqlExport', table)
    expect(openModal).toHaveBeenNthCalledWith(2, 'sqlImport', table)
  })

  it('says what to select when nothing deep enough is in focus', () => {
    runPgTool('pgSearch')
    expect(openModal).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Select a PostgreSQL schema or table first')
  })
})
