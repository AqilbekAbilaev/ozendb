import { describe, it, expect, vi, beforeEach } from 'vitest'

const openMySqlTable = vi.fn()
vi.mock('../../../stores/tabCreators', () => ({ openMySqlTable }))

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

  it('is the action the engine table finds for a MySQL node', () => {
    expect(contextAction(table, 'mysql:open_table')).toBe(MYSQL_ACTIONS['mysql:open_table'])
  })
})
