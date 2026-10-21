import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../appApi/sync', () => ({ getSyncStatus: vi.fn(), syncNow: vi.fn() }))
vi.mock('../appApi/events', () => ({ onSyncStatus: vi.fn() }))

import { getSyncStatus, syncNow as askForSync } from '../appApi/sync'
import { onSyncStatus } from '../appApi/events'
import { syncStatus, startSyncStatus, syncNow, resetSyncStatus } from './sync'

const NOW = 1792600000000

function status(fields) {
  return { status: 'synced', error: null, received_only: false, keychain_error: null, time: NOW, last_synced: NOW, ...fields }
}

// The handler the store subscribed with, to send it a status as the backend would.
function send(sent) {
  onSyncStatus.mock.calls[0][0](sent)
}

beforeEach(() => {
  vi.resetAllMocks()
  resetSyncStatus()
  onSyncStatus.mockResolvedValue(() => {})
})

describe('sync store', () => {
  it('takes the latest status the backend kept', async () => {
    const kept = status({ time: NOW - 1000 })
    getSyncStatus.mockResolvedValue(kept)
    await startSyncStatus()
    expect(syncStatus.value).toEqual(kept)
  })

  it('stays empty when the backend has sent no status yet', async () => {
    getSyncStatus.mockResolvedValue(null)
    await startSyncStatus()
    expect(syncStatus.value).toBeNull()
  })

  it('follows each status sent after it started', async () => {
    getSyncStatus.mockResolvedValue(status({ time: NOW - 1000 }))
    await startSyncStatus()
    const running = status({ status: 'running', time: NOW })
    send(running)
    expect(syncStatus.value).toEqual(running)
  })

  it('keeps a status sent while the kept one was being read, when it is newer', async () => {
    const sent = status({ status: 'failed', error: { code: 'unreachable', message: 'Could not reach "api.ozendb.com".' }, time: NOW })
    getSyncStatus.mockImplementation(async () => {
      send(sent)
      return status({ status: 'running', time: NOW - 1000 })
    })
    await startSyncStatus()
    expect(syncStatus.value).toEqual(sent)
  })

  it('asks the backend for a sync', async () => {
    askForSync.mockResolvedValue(null)
    await syncNow()
    expect(askForSync).toHaveBeenCalledTimes(1)
  })

  it('stops listening when reset', async () => {
    const stop = vi.fn()
    onSyncStatus.mockResolvedValue(stop)
    getSyncStatus.mockResolvedValue(null)
    await startSyncStatus()
    resetSyncStatus()
    expect(stop).toHaveBeenCalledTimes(1)
  })
})
