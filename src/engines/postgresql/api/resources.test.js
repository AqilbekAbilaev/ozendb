import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { listSchemas, listTables, listColumns } from './resources'

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue([])
})

describe('PostgreSQL resources', () => {
  it('lists the schemas of a connection', async () => {
    await listSchemas('c1')
    expect(invoke).toHaveBeenCalledWith('list_pg_schemas', { id: 'c1' })
  })

  it('lists the tables of a schema', async () => {
    await listTables({ connectionId: 'c1', schema: 'public' })
    expect(invoke).toHaveBeenCalledWith('list_pg_tables', { id: 'c1', schema: 'public' })
  })

  it('lists the columns of a table', async () => {
    await listColumns({ connectionId: 'c1', schema: 'public', table: 'users' })
    expect(invoke).toHaveBeenCalledWith('list_pg_columns', { id: 'c1', schema: 'public', table: 'users' })
  })
})
