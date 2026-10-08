import { describe, it, expect, vi, beforeEach } from 'vitest'

const openPostgresQuery = vi.fn()
const openPostgresTable = vi.fn()
const openPostgresSearch = vi.fn()
vi.mock('../../../stores/tabCreators', () => ({ openPostgresQuery, openPostgresTable, openPostgresSearch }))
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
    PG_ACTIONS['pg:new_sql'](table)
    expect(openPostgresQuery).toHaveBeenCalledWith({ connectionId: 'p1', connectionName: 'Payments PG', database: 'payments' })
  })

  it('opens the table it was opened on', () => {
    PG_ACTIONS['pg:open_table'](table)
    expect(openPostgresTable).toHaveBeenCalledWith({
      connectionId: 'p1', connectionName: 'Payments PG', database: 'payments', schema: 'public', table: 'merchants',
    })
  })

  it('offers no MongoDB-only action', () => {
    const ids = Object.values(PG_MENUS).flat().map(i => i.value).filter(Boolean)
    // Server Info was on this list until PostgreSQL grew diagnostics of its own; the
    // rest have no PostgreSQL equivalent yet, so they must not appear.
    for (const mongoOnly of ['file:intellishell', 'db:current_ops', 'db:add_database', 'coll:import', 'coll:export', 'file:search']) {
      expect(ids).not.toContain(mongoOnly)
    }
  })

  it('opens its own Server Info, not MongoDB\'s', () => {
    expect(PG_MENUS.connection.map(i => i.value)).toContain('pg:server_info')
    // Only the connection level has one: a schema or table has no server to report on.
    for (const level of ['database', 'schema', 'table']) {
      expect(PG_MENUS[level].map(i => i.value)).not.toContain('pg:server_info')
    }
    PG_ACTIONS['pg:server_info']({ connId: 'p1', connName: 'Payments PG' })
    expect(openModal).toHaveBeenCalledWith('pgServerInfo', { connId: 'p1', connName: 'Payments PG' })
  })

  it('offers each schema change on the node it applies to', () => {
    const ids = (level) => PG_MENUS[level].map(i => i.value)
    expect(ids('database')).toContain('pg:create_schema')
    expect(ids('schema')).toEqual(expect.arrayContaining(['pg:create_table', 'pg:drop_schema']))
    expect(ids('table')).toEqual(expect.arrayContaining(['pg:rename_table', 'pg:drop_table']))
    PG_ACTIONS['pg:drop_table'](table)
    expect(openModal).toHaveBeenCalledWith('pgDrop', table)
    PG_ACTIONS['pg:rename_table'](table)
    expect(openModal).toHaveBeenCalledWith('pgRenameTable', table)
  })

  it('opens cross-table search on the schema it was opened on', () => {
    expect(PG_MENUS.schema.map(i => i.value)).toContain('pg:search_schema')
    const schemaNode = { connId: 'p1', connName: 'Payments PG', engine: 'postgresql', database: 'payments', schema: 'public' }
    PG_ACTIONS['pg:search_schema'](schemaNode)
    expect(openPostgresSearch).toHaveBeenCalledWith({ connectionId: 'p1', connectionName: 'Payments PG', database: 'payments', schema: 'public' })
  })

  // #128: the whole table, through the export dialog.
  it('exports the table it was opened on', () => {
    expect(PG_MENUS.table.map(i => i.value)).toContain('pg:export_table')
    PG_ACTIONS['pg:export_table'](table)
    expect(openModal).toHaveBeenCalledWith('pgExport', table)
  })

  it('imports a CSV into the table it was opened on', () => {
    expect(PG_MENUS.table.map(i => i.value)).toContain('pg:import_csv')
    PG_ACTIONS['pg:import_csv'](table)
    expect(openModal).toHaveBeenCalledWith('pgImport', table)
  })
})
