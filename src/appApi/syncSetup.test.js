import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  getSyncSetupStatus,
  createSyncKeys,
  finishSyncSetup,
  unlockSyncWithPassword,
  unlockSyncWithRecoveryKey,
} from './syncSetup'

const PASSWORD = 'correct horse/battery.staple — ünïcödé'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getSyncSetupStatus', () => {
  it('invokes sync_setup_status without arguments', async () => {
    invoke.mockResolvedValue({ state: 'new' })
    await getSyncSetupStatus()
    expect(invoke).toHaveBeenCalledWith('sync_setup_status')
  })
})

describe('createSyncKeys', () => {
  it('invokes create_sync_keys with the password', async () => {
    invoke.mockResolvedValue('00FQ-X055-RFZM-568G-BBKK-SP3B-Y3')
    await createSyncKeys(PASSWORD)
    expect(invoke).toHaveBeenCalledWith('create_sync_keys', { password: PASSWORD })
  })
})

describe('finishSyncSetup', () => {
  it('invokes finish_sync_setup without arguments', async () => {
    invoke.mockResolvedValue(null)
    await finishSyncSetup()
    expect(invoke).toHaveBeenCalledWith('finish_sync_setup')
  })
})

describe('unlockSyncWithPassword', () => {
  it('invokes unlock_sync_with_password with the password', async () => {
    invoke.mockResolvedValue(null)
    await unlockSyncWithPassword(PASSWORD)
    expect(invoke).toHaveBeenCalledWith('unlock_sync_with_password', { password: PASSWORD })
  })
})

describe('unlockSyncWithRecoveryKey', () => {
  it('invokes unlock_sync_with_recovery_key with the key as typed', async () => {
    invoke.mockResolvedValue(null)
    await unlockSyncWithRecoveryKey(' 00fq – x055 rfzm ')
    expect(invoke).toHaveBeenCalledWith('unlock_sync_with_recovery_key', { recoveryKey: ' 00fq – x055 rfzm ' })
  })
})
