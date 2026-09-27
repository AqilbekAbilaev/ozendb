import { describe, it, expect, vi, beforeEach } from 'vitest'

const openPostgresQuery = vi.fn()
const openPostgresTable = vi.fn()
vi.mock('../../../stores/tabCreators', () => ({ openPostgresQuery, openPostgresTable }))

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
    for (const mongoOnly of ['Open IntelliShell', 'Server Info', 'Current Operations', 'Add Database…', 'Import…', 'Export…', 'Search in…']) {
      expect(labels).not.toContain(mongoOnly)
    }
  })
})
