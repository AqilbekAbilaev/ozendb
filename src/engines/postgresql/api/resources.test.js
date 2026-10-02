import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { listSchemas, listTables, listColumns, listForeignKeys, searchTables } from './resources'

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

  it('lists the foreign keys linking a table to others', async () => {
    await listForeignKeys({ connectionId: 'c1', schema: 'public', table: 'users' })
    expect(invoke).toHaveBeenCalledWith('list_pg_foreign_keys', { id: 'c1', schema: 'public', table: 'users' })
  })

  it('searches every table in a schema by default', async () => {
    await searchTables({ connectionId: 'c1', schema: 'public' }, 'widget')
    expect(invoke).toHaveBeenCalledWith('search_pg_tables', {
      id: 'c1', schema: 'public', tables: null, term: 'widget', matchCase: false, regex: false, limit: null, runId: null,
    })
  })

  it('scopes a search to an explicit table list and passes through every option', async () => {
    await searchTables({ connectionId: 'c1', schema: 'public', tables: ['users'] }, 'widget', { matchCase: true, regex: true, limit: 50, runId: 'r1' })
    expect(invoke).toHaveBeenCalledWith('search_pg_tables', {
      id: 'c1', schema: 'public', tables: ['users'], term: 'widget', matchCase: true, regex: true, limit: 50, runId: 'r1',
    })
  })
})
