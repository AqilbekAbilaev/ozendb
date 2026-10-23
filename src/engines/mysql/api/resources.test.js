import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { listDatabases, listTables, listColumns, listForeignKeys } from './resources'

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue([])
})

describe('MySQL resources', () => {
  it('lists the databases of a connection', async () => {
    await listDatabases('c1')
    expect(invoke).toHaveBeenCalledWith('list_mysql_databases', { id: 'c1' })
  })

  it('lists the tables and views of a database', async () => {
    await listTables({ connectionId: 'c1', database: 'shop `2024` ü' })
    expect(invoke).toHaveBeenCalledWith('list_mysql_tables', { id: 'c1', database: 'shop `2024` ü' })
  })

  it('lists the columns of a table', async () => {
    await listColumns({ connectionId: 'c1', database: 'shop.eu', table: 'order items' })
    expect(invoke).toHaveBeenCalledWith('list_mysql_columns', { id: 'c1', database: 'shop.eu', table: 'order items' })
  })

  it('lists the foreign keys on either side of a table', async () => {
    await listForeignKeys({ connectionId: 'c1', database: 'shop.eu', table: 'order items' })
    expect(invoke).toHaveBeenCalledWith('list_mysql_foreign_keys', { id: 'c1', database: 'shop.eu', table: 'order items' })
  })
})
