import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  connectionUri,
} from './connections'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('connectionUri', () => {
  it('translates the id into the connection_uri payload', async () => {
    invoke.mockResolvedValue('mongodb://localhost:27017')
    await connectionUri('connection-1')
    expect(invoke).toHaveBeenCalledWith('connection_uri', { id: 'connection-1' })
  })

  it('resolves with the command response unchanged', async () => {
    const uri = 'mongodb://localhost:27017'
    invoke.mockResolvedValue(uri)
    await expect(connectionUri('connection-1')).resolves.toBe(uri)
  })
})
