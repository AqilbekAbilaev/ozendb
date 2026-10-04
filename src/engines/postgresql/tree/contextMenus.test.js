import { describe, it, expect, vi, beforeEach } from 'vitest'

const openPostgresQuery = vi.fn()
const openPostgresTable = vi.fn()
vi.mock('../../../stores/tabCreators', () => ({ openPostgresQuery, openPostgresTable }))
const openModal = vi.fn()
vi.mock('../../../stores/modals', () => ({ openModal }))

const { PG_MENUS, PG_ACTIONS } = await import('./contextMenus.js')

const table = { connId: 'p1', connName: 'Payments PG', engine: 'postgresql', database: 'payments', schema: 'public', table: 'merchants' }

beforeEach(() => vi.clearAllMocks())

describe('PostgreSQL right-click menus', () => {
  it('has a menu for each level of the PostgreSQL tree', () => {
    expect(Object.keys(PG_MENUS)).toEqual(['connection', 'database', 'schema', 'table'])
  })

  it('opens a SQL tab on the node\'s database', () => {
    PG_ACTIONS['New SQL Query'](table)
    expect(openPostgresQuery).toHaveBeenCalledWith({ connectionId: 'p1', connectionName: 'Payments PG', database: 'payments' })
  })

  it('opens the table it was opened on', () => {
    PG_ACTIONS['Open Table'](table)
    expect(openPostgresTable).toHaveBeenCalledWith({
      connectionId: 'p1', connectionName: 'Payments PG', database: 'payments', schema: 'public', table: 'merchants',
    })
  })

  it('offers no MongoDB-only action', () => {
    const labels = Object.values(PG_MENUS).flat().map(i => i.label).filter(Boolean)
    // Server Info was on this list until PostgreSQL grew diagnostics of its own; the
    // rest have no PostgreSQL equivalent yet, so they must not appear.
    for (const mongoOnly of ['Open IntelliShell', 'Current Operations', 'Add Database…', 'Import…', 'Export…', 'Search in…']) {
      expect(labels).not.toContain(mongoOnly)
    }
  })

  it('opens its own Server Info, not MongoDB\'s', () => {
    expect(PG_MENUS.connection.map(i => i.label)).toContain('Server Info')
    // Only the connection level has one: a schema or table has no server to report on.
    for (const level of ['database', 'schema', 'table']) {
      expect(PG_MENUS[level].map(i => i.label)).not.toContain('Server Info')
    }
    PG_ACTIONS['Server Info']({ connId: 'p1', connName: 'Payments PG' })
    expect(openModal).toHaveBeenCalledWith('pgServerInfo', { connId: 'p1', connName: 'Payments PG' })
  })

  it('offers each schema change on the node it applies to', () => {
    const labels = (level) => PG_MENUS[level].map(i => i.label)
    expect(labels('database')).toContain('Create Schema…')
    expect(labels('schema')).toEqual(expect.arrayContaining(['Create Table…', 'Drop Schema…']))
    expect(labels('table')).toEqual(expect.arrayContaining(['Rename Table…', 'Drop Table…']))
    PG_ACTIONS['Drop Table…'](table)
    expect(openModal).toHaveBeenCalledWith('pgDrop', table)
    PG_ACTIONS['Rename Table…'](table)
    expect(openModal).toHaveBeenCalledWith('pgRenameTable', table)
  })

  it('opens cross-table search on the schema it was opened on', () => {
    expect(PG_MENUS.schema.map(i => i.label)).toContain('Search in Schema…')
    const schemaNode = { connId: 'p1', connName: 'Payments PG', engine: 'postgresql', database: 'payments', schema: 'public' }
    PG_ACTIONS['Search in Schema…'](schemaNode)
    expect(openModal).toHaveBeenCalledWith('pgSearch', schemaNode)
  })

  // ozendb-6v3: the whole table, through the export dialog.
  it('exports the table it was opened on', () => {
    expect(PG_MENUS.table.map(i => i.label)).toContain('Export Table…')
    PG_ACTIONS['Export Table…'](table)
    expect(openModal).toHaveBeenCalledWith('pgExport', table)
  })
})
