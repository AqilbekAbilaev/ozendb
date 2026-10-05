import { describe, it, expect, vi, beforeEach } from 'vitest'

const openPostgresQuery = vi.fn()
const openPostgresTable = vi.fn()
vi.mock('../../stores/tabCreators', () => ({ openPostgresQuery, openPostgresTable }))
const openModal = vi.fn()
vi.mock('../../stores/modals', () => ({ openModal }))
const showToast = vi.fn()
vi.mock('../../stores/toast', () => ({ showToast }))

const { runPgTool } = await import('./toolbarActions.js')

const table = {
  connId: 'p1', connName: 'Payments PG', connectionId: 'p1', connectionName: 'Payments PG',
  database: 'payments', schema: 'public', table: 'merchants',
}
const schema = { ...table, table: null }
const resolving = (target) => vi.fn(() => target)

beforeEach(() => vi.clearAllMocks())

describe('runPgTool', () => {
  it("leaves every other tool to the MongoDB dispatcher", () => {
    expect(runPgTool('collection', resolving(table))).toBe(false)
    expect(openPostgresTable).not.toHaveBeenCalled()
  })

  it('opens the table in focus', () => {
    const target = resolving(table)
    expect(runPgTool('pgTable', target)).toBe(true)
    expect(target).toHaveBeenCalledWith('table')
    expect(openPostgresTable).toHaveBeenCalledWith({
      connectionId: 'p1', connectionName: 'Payments PG', database: 'payments', schema: 'public', table: 'merchants',
    })
  })

  it('asks for a table when only a schema is in focus', () => {
    expect(runPgTool('pgTable', resolving(schema))).toBe(true)
    expect(openPostgresTable).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Select a PostgreSQL table first')
  })

  it('opens a SQL tab on the database in focus', () => {
    const target = resolving(schema)
    runPgTool('pgSql', target)
    expect(target).toHaveBeenCalledWith('schema')
    expect(openPostgresQuery).toHaveBeenCalledWith({ connectionId: 'p1', connectionName: 'Payments PG', database: 'payments' })
  })

  it('opens Search in Schema on the schema in focus', () => {
    runPgTool('pgSearch', resolving(schema))
    expect(openModal).toHaveBeenCalledWith('pgSearch', schema)
  })

  it('opens export and import on the table in focus', () => {
    runPgTool('pgExport', resolving(table))
    runPgTool('pgImport', resolving(table))
    expect(openModal).toHaveBeenNthCalledWith(1, 'pgExport', table)
    expect(openModal).toHaveBeenNthCalledWith(2, 'pgImport', table)
  })

  it('says what to select when nothing deep enough is in focus', () => {
    runPgTool('pgSearch', resolving(null))
    expect(openModal).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Select a PostgreSQL schema or table first')
  })
})
