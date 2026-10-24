import { describe, it, expect, vi, beforeEach } from 'vitest'

const openMySqlTable = vi.fn()
const openMySqlQuery = vi.fn()
vi.mock('../../../stores/tabCreators', () => ({ openMySqlTable, openMySqlQuery }))

const { MYSQL_MENUS, MYSQL_ACTIONS } = await import('./contextMenus.js')
const { contextAction } = await import('../../contextActions.js')
const { createResourceRef } = await import('../../../utils/resourceRef')

const resource = createResourceRef('m1', [{ kind: 'database', name: 'shop `2024` ü' }, { kind: 'table', name: 'order items' }])
const table = { connId: 'm1', connName: 'Shop MySQL', engine: 'mysql', resource }

beforeEach(() => vi.clearAllMocks())

describe('MySQL right-click menus', () => {
  it('offers to open a table from its row', () => {
    expect(MYSQL_MENUS.table.map(item => item.value)).toContain('mysql:open_table')
  })

  it('opens the table it was opened on, by its ref', () => {
    MYSQL_ACTIONS['mysql:open_table'](table)
    expect(openMySqlTable).toHaveBeenCalledWith({ resource, connectionName: 'Shop MySQL' })
  })

  it('offers a SQL query on the connection, a database and a table', () => {
    for (const level of ['connection', 'database', 'table']) expect(MYSQL_MENUS[level].map(item => item.value)).toContain('mysql:new_sql')
  })

  it('opens a SQL query on the row it was opened on, by its ref', () => {
    MYSQL_ACTIONS['mysql:new_sql'](table)
    expect(openMySqlQuery).toHaveBeenCalledWith({ resource, connectionName: 'Shop MySQL' })
  })

  it('offers to open a view as a table, and a SQL query on it', () => {
    expect(MYSQL_MENUS.view.map(item => item.value)).toEqual(expect.arrayContaining(['mysql:open_table', 'mysql:new_sql', 'node:copy_name']))
  })

  it('offers a SQL query and its name on a stored program\'s row, but nothing that would open it as a table', () => {
    const offered = MYSQL_MENUS.program.map(item => item.value)
    expect(offered).toEqual(expect.arrayContaining(['mysql:new_sql', 'node:copy_name']))
    expect(offered).not.toContain('mysql:open_table')
  })

  it('is the action the engine table finds for a MySQL node', () => {
    expect(contextAction(table, 'mysql:open_table')).toBe(MYSQL_ACTIONS['mysql:open_table'])
  })
})
