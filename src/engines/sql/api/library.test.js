import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { listHistory, pushHistory, clearHistory, listSaved, saveQuery, deleteSaved } from './library'

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue(null)
})

describe('The SQL query library', () => {
  it('reads, adds to and clears a connection\'s history', async () => {
    await listHistory('c1')
    expect(invoke).toHaveBeenCalledWith('list_sql_history', { connectionId: 'c1' })
    await pushHistory('c1', 'SELECT 1')
    expect(invoke).toHaveBeenCalledWith('push_sql_history', { connectionId: 'c1', sql: 'SELECT 1' })
    await clearHistory('c1')
    expect(invoke).toHaveBeenCalledWith('clear_sql_history', { connectionId: 'c1' })
  })

  it('lists, saves and deletes saved queries', async () => {
    await listSaved('c1')
    expect(invoke).toHaveBeenCalledWith('list_sql_saved', { connectionId: 'c1' })
    await saveQuery('c1', 'Top', 'SELECT 1')
    expect(invoke).toHaveBeenCalledWith('save_sql_query', { connectionId: 'c1', name: 'Top', sql: 'SELECT 1' })
    await deleteSaved('q1')
    expect(invoke).toHaveBeenCalledWith('delete_sql_saved', { id: 'q1' })
  })
})
