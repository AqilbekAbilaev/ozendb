import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { runQuery, browseTable, countTable, updateRow } from './queries'

const table = { connectionId: 'c1', schema: 'public', table: 'users' }

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue(null)
})

describe('PostgreSQL queries', () => {
  it('runs SQL against a connection', async () => {
    await runQuery('c1', 'SELECT 1')
    expect(invoke).toHaveBeenCalledWith('run_pg_query', { id: 'c1', sql: 'SELECT 1' })
  })

  it('browses a page of a table, unordered by default', async () => {
    await browseTable(table, { limit: 50, offset: 100 })
    expect(invoke).toHaveBeenCalledWith('browse_pg_table', {
      id: 'c1', schema: 'public', table: 'users',
      orderBy: null, descending: false, limit: 50, offset: 100,
    })
  })

  it('passes a sort column and direction through', async () => {
    await browseTable(table, { orderBy: 'name', descending: true, limit: 50, offset: 0 })
    expect(invoke).toHaveBeenCalledWith('browse_pg_table', expect.objectContaining({ orderBy: 'name', descending: true }))
  })

  it('counts the rows of a table', async () => {
    await countTable(table)
    expect(invoke).toHaveBeenCalledWith('count_pg_table', { id: 'c1', schema: 'public', table: 'users' })
  })

  it('updates one row, identified by its key columns', async () => {
    const set = [{ column: 'name', value: 'Ada' }]
    const where = [{ column: 'id', value: 1 }]
    await updateRow(table, set, where)
    expect(invoke).toHaveBeenCalledWith('update_pg_row', { id: 'c1', schema: 'public', table: 'users', set, where })
  })
})
