import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { browseTable, countTable } from './queries'

const target = { connectionId: 'c1', database: 'shop `2024` ü', table: 'order items' }

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue(null)
})

describe('MySQL queries', () => {
  it('browses a page of a table, sorted by a column', async () => {
    const filters = [{ table: 0, column: 'qty', op: 'gt', value: '5' }]
    await browseTable(target, { filters, orderBy: { table: 0, column: 'qty' }, descending: true, limit: 50, offset: 100 })
    expect(invoke).toHaveBeenCalledWith('browse_mysql_table', {
      id: 'c1', database: 'shop `2024` ü', table: 'order items', filters, orderBy: 'qty', descending: true, limit: 50, offset: 100,
    })
  })

  it('browses by the primary key when no column is chosen', async () => {
    await browseTable(target, { orderBy: null, limit: 100, offset: 0 })
    expect(invoke).toHaveBeenCalledWith('browse_mysql_table', expect.objectContaining({ filters: [], orderBy: null, descending: false }))
  })

  it('counts the rows the filters keep', async () => {
    await countTable(target, [{ table: 0, column: 'qty', op: 'isNull' }])
    expect(invoke).toHaveBeenCalledWith('count_mysql_table', {
      id: 'c1', database: 'shop `2024` ü', table: 'order items', filters: [{ table: 0, column: 'qty', op: 'isNull' }],
    })
  })
})
