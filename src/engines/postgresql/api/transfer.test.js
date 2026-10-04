import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { exportData } from './transfer'

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue({ rows: 1, bytes: 10 })
})

describe('exportData', () => {
  it('sends the source, format and path for one database', async () => {
    await exportData({ connectionId: 'p1', database: 'shop' }, { schema: 'public', table: 'orders' }, 'csv', '/tmp/o.csv')
    expect(invoke).toHaveBeenCalledWith('export_pg_data', {
      id: 'p1', database: 'shop', source: { schema: 'public', table: 'orders' }, format: 'csv', path: '/tmp/o.csv',
    })
  })

  it('leaves the database out for the connection\'s own', async () => {
    await exportData({ connectionId: 'p1' }, { query: 'SELECT 1' }, 'json', '/tmp/q.json')
    expect(invoke).toHaveBeenCalledWith('export_pg_data', expect.objectContaining({ database: null }))
  })
})
