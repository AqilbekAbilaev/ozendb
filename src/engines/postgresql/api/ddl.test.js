import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { createSchema, dropSchema, createTable, dropTable, renameTable } from './ddl'

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue(null)
})

const target = { connectionId: 'c1', schema: 'public', table: 'users' }

describe('PostgreSQL schema changes', () => {
  it('creates and drops a schema', async () => {
    await createSchema('c1', 'sales')
    expect(invoke).toHaveBeenCalledWith('create_pg_schema', { id: 'c1', name: 'sales' })
    await dropSchema('c1', 'sales', true)
    expect(invoke).toHaveBeenCalledWith('drop_pg_schema', { id: 'c1', name: 'sales', cascade: true })
  })

  it('creates a table from its column list', async () => {
    const table = { schema: 'public', name: 't', columns: [{ name: 'id', dataType: 'bigint', nullable: false, primaryKey: true, identity: true }] }
    await createTable('c1', table)
    expect(invoke).toHaveBeenCalledWith('create_pg_table', { id: 'c1', table })
  })

  it('drops and renames a table', async () => {
    await dropTable(target, false)
    expect(invoke).toHaveBeenCalledWith('drop_pg_table', { id: 'c1', schema: 'public', table: 'users', cascade: false })
    await renameTable(target, 'people')
    expect(invoke).toHaveBeenCalledWith('rename_pg_table', { id: 'c1', schema: 'public', table: 'users', newName: 'people' })
  })
})
