import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { setConnectionOpen, updateLastAccessed } from './connectionState'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('setConnectionOpen', () => {
  it('passes the connection id and open flag through to set_connection_open', async () => {
    invoke.mockResolvedValue(null)
    await setConnectionOpen('c1', true)
    expect(invoke).toHaveBeenCalledWith('set_connection_open', { id: 'c1', open: true })
  })
})

describe('updateLastAccessed', () => {
  it('passes the connection id and timestamp through to update_last_accessed', async () => {
    invoke.mockResolvedValue(null)
    await updateLastAccessed('c1', '2026-08-20T00:00:00Z')
    expect(invoke).toHaveBeenCalledWith('update_last_accessed', {
      id: 'c1',
      timestamp: '2026-08-20T00:00:00Z',
    })
  })
})