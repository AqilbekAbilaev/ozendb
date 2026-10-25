import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { exportData, importPreview, importCsv } from './transfer'

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue({ rows: 1, bytes: 10 })
})

describe('MySQL transfer', () => {
  it('exports a query from the database its session starts in', async () => {
    await exportData({ connectionId: 'm1', database: 'shop `2024` ü' }, { query: 'SELECT 1' }, 'json', '/tmp/q.json')
    expect(invoke).toHaveBeenCalledWith('export_mysql_data', {
      id: 'm1', database: 'shop `2024` ü', source: { query: 'SELECT 1' }, format: 'json', path: '/tmp/q.json',
    })
  })

  it('leaves the database out for the connection\'s own', async () => {
    await exportData({ connectionId: 'm1' }, { schema: 'shop', table: 'order items' }, 'csv', '/tmp/o.csv')
    expect(invoke).toHaveBeenCalledWith('export_mysql_data', expect.objectContaining({ database: null }))
  })

  it('previews and imports a file into a table of a database', async () => {
    const table = { connectionId: 'm1', database: 'shop `2024` ü', table: 'order items' }
    await importPreview(table, '/tmp/o.csv')
    await importCsv(table, '/tmp/o.csv', ['id', null])
    expect(invoke.mock.calls).toEqual([
      ['mysql_import_preview_csv', { id: 'm1', database: 'shop `2024` ü', table: 'order items', path: '/tmp/o.csv' }],
      ['import_mysql_csv', { id: 'm1', database: 'shop `2024` ü', table: 'order items', path: '/tmp/o.csv', mapping: ['id', null] }],
    ])
  })
})
