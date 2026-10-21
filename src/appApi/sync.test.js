import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { syncNow, getSyncStatus } from './sync'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('syncNow', () => {
  it('invokes sync_now without arguments', async () => {
    invoke.mockResolvedValue(null)
    await syncNow()
    expect(invoke).toHaveBeenCalledWith('sync_now')
  })
})

describe('getSyncStatus', () => {
  it('invokes sync_status and answers what it returns', async () => {
    const status = { status: 'synced', error: null, received_only: false, keychain_error: null, time: 1792600000000, last_synced: 1792600000000 }
    invoke.mockResolvedValue(status)
    expect(await getSyncStatus()).toBe(status)
    expect(invoke).toHaveBeenCalledWith('sync_status')
  })
})
