import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

vi.mock('../appApi/syncSetup', () => ({
  getSyncSetupStatus: vi.fn(),
  createSyncKeys: vi.fn(),
  finishSyncSetup: vi.fn(),
  unlockSyncWithPassword: vi.fn(),
  unlockSyncWithRecoveryKey: vi.fn(),
}))

import {
  getSyncSetupStatus,
  createSyncKeys,
  finishSyncSetup,
  unlockSyncWithPassword,
  unlockSyncWithRecoveryKey,
} from '../appApi/syncSetup'
import { entitlement, resetPremium } from '../stores/premium'
import { useSyncSetup } from './useSyncSetup'

const PASSWORD = 'correct horse/battery.staple — ünïcödé'
const RECOVERY_KEY = '00FQ-X055-RFZM-568G-BBKK-SP3B-Y3'

let scope

async function setup() {
  scope = effectScope()
  const sync = scope.run(() => useSyncSetup())
  await vi.waitFor(() => expect(sync.step.value).not.toBe('checking'))
  return sync
}

function failure(code) {
  return { code, message: `The backend said ${code}.` }
}

async function chosen() {
  const sync = await setup()
  sync.password.value = PASSWORD
  sync.confirmation.value = PASSWORD
  await sync.choose()
  return sync
}

async function saved() {
  const sync = await chosen()
  sync.recoveryKeySaved.value = true
  return sync
}

beforeEach(() => {
  vi.resetAllMocks()
  resetPremium()
  entitlement.value = { state: 'premium', until: Date.now() + 60_000 }
  getSyncSetupStatus.mockResolvedValue({ state: 'new' })
  createSyncKeys.mockResolvedValue(RECOVERY_KEY)
  finishSyncSetup.mockResolvedValue(null)
  unlockSyncWithPassword.mockResolvedValue(null)
  unlockSyncWithRecoveryKey.mockResolvedValue(null)
})

afterEach(() => {
  scope?.stop()
})

describe('useSyncSetup', () => {
  it('asks a free account for Premium without asking the server', async () => {
    entitlement.value = { state: 'free' }
    const { step } = await setup()
    expect(step.value).toBe('premium_needed')
    expect(getSyncSetupStatus).not.toHaveBeenCalled()
  })

  it('shows a device that already holds the keys as set up', async () => {
    getSyncSetupStatus.mockResolvedValue({ state: 'set_up' })
    expect((await setup()).step.value).toBe('set_up')
  })

  it('asks the first device for a new sync password', async () => {
    expect((await setup()).step.value).toBe('choose')
  })

  it('asks another device to unlock, saying whether a recovery key can', async () => {
    getSyncSetupStatus.mockResolvedValue({ state: 'existing', recovery: true })
    const { step, recoveryAvailable } = await setup()
    expect([step.value, recoveryAvailable.value]).toEqual(['unlock', true])
  })

  it('shows Premium as needed when the server refuses a free account', async () => {
    getSyncSetupStatus.mockRejectedValue(failure('not_premium'))
    expect((await setup()).step.value).toBe('premium_needed')
  })

  it('shows why the status could not be read, and clears it on trying again', async () => {
    getSyncSetupStatus.mockRejectedValueOnce(failure('unreachable'))
    const sync = await setup()
    expect([sync.step.value, sync.error.value]).toEqual(['failed', "Can't reach the OzenDB server. Check your internet connection."])

    await sync.checkAgain()

    expect([sync.step.value, sync.error.value]).toEqual(['choose', ''])
  })

  it('refuses a short password without making keys', async () => {
    const sync = await setup()
    sync.password.value = 'short pw é'
    sync.confirmation.value = 'short pw é'
    await sync.choose()
    expect(sync.error.value).toBe('Use at least 12 characters.')
    expect(createSyncKeys).not.toHaveBeenCalled()
  })

  it('shows the recovery key once the keys are made, and forgets the typed password', async () => {
    const sync = await chosen()
    expect(createSyncKeys).toHaveBeenCalledWith(PASSWORD)
    expect([sync.step.value, sync.recoveryKey.value]).toEqual(['recovery_key', RECOVERY_KEY])
    expect([sync.password.value, sync.confirmation.value]).toEqual(['', ''])
  })

  it('forgets the typed password when making the keys fails', async () => {
    createSyncKeys.mockRejectedValue(failure('keychain'))
    const sync = await chosen()
    expect(sync.step.value).toBe('choose')
    expect([sync.password.value, sync.confirmation.value]).toEqual(['', ''])
  })

  it('waits for the user to say they saved the recovery key', async () => {
    const sync = await chosen()
    await sync.finish()
    expect([sync.step.value, sync.recoveryKey.value]).toEqual(['recovery_key', RECOVERY_KEY])
    expect(finishSyncSetup).not.toHaveBeenCalled()
  })

  it('forgets the recovery key and finishes once the user saved it', async () => {
    const sync = await chosen()
    sync.recoveryKeySaved.value = true
    await sync.finish()
    expect([sync.step.value, sync.recoveryKey.value]).toEqual(['set_up', ''])
  })

  it('offers to try the first upload again when it fails, without the recovery key', async () => {
    finishSyncSetup.mockRejectedValueOnce(failure('unreachable'))
    const sync = await saved()
    await sync.finish()
    expect([sync.step.value, sync.recoveryKey.value]).toEqual(['retry', ''])

    await sync.finish()

    expect(sync.step.value).toBe('set_up')
  })

  it('says Premium is needed when the first upload is refused for it', async () => {
    finishSyncSetup.mockRejectedValue(failure('not_premium'))
    const sync = await saved()
    await sync.finish()
    expect([sync.step.value, sync.error.value]).toEqual(['retry', 'Syncing needs OzenDB Premium.'])
  })

  it('switches to unlocking when another device set sync up first', async () => {
    finishSyncSetup.mockRejectedValue(failure('sync_set_up_elsewhere'))
    const sync = await saved()
    getSyncSetupStatus.mockResolvedValue({ state: 'existing', recovery: false })
    await sync.finish()
    expect(sync.step.value).toBe('unlock')
    expect(sync.error.value).toContain('Another device set up sync for this account first.')
  })

  it('asks again whether a new recovery key was saved', async () => {
    finishSyncSetup.mockRejectedValue(failure('sync_not_set_up'))
    const sync = await saved()
    await sync.finish()
    sync.password.value = PASSWORD
    sync.confirmation.value = PASSWORD
    await sync.choose()
    expect([sync.step.value, sync.recoveryKeySaved.value]).toEqual(['recovery_key', false])
  })

  it('asks for the password again when the backend lost the new keys', async () => {
    finishSyncSetup.mockRejectedValue(failure('sync_not_set_up'))
    const sync = await saved()
    await sync.finish()
    expect([sync.step.value, sync.error.value]).toEqual(['choose', 'The new keys were lost. Choose your sync password again.'])
  })

  it('unlocks with the sync password', async () => {
    getSyncSetupStatus.mockResolvedValue({ state: 'existing', recovery: true })
    const sync = await setup()
    sync.password.value = PASSWORD
    await sync.unlock()
    expect(unlockSyncWithPassword).toHaveBeenCalledWith(PASSWORD)
    expect([sync.step.value, sync.password.value]).toEqual(['set_up', ''])
  })

  it('unlocks with the recovery key as typed', async () => {
    getSyncSetupStatus.mockResolvedValue({ state: 'existing', recovery: true })
    const sync = await setup()
    sync.unlockWith.value = 'recovery_key'
    sync.typedRecoveryKey.value = ' 00fq – x055 '
    await sync.unlock()
    expect(unlockSyncWithRecoveryKey).toHaveBeenCalledWith(' 00fq – x055 ')
    expect([sync.step.value, sync.typedRecoveryKey.value]).toEqual(['set_up', ''])
  })

  it('says a wrong password is wrong and clears it', async () => {
    getSyncSetupStatus.mockResolvedValue({ state: 'existing', recovery: false })
    unlockSyncWithPassword.mockRejectedValue(failure('wrong_sync_password'))
    const sync = await setup()
    sync.password.value = 'wrong one, ü'
    await sync.unlock()
    expect([sync.step.value, sync.error.value, sync.password.value]).toEqual(['unlock', 'That sync password is wrong.', ''])
  })

  it('says a wrong recovery key is wrong', async () => {
    getSyncSetupStatus.mockResolvedValue({ state: 'existing', recovery: true })
    unlockSyncWithRecoveryKey.mockRejectedValue(failure('wrong_recovery_key'))
    const sync = await setup()
    sync.unlockWith.value = 'recovery_key'
    sync.typedRecoveryKey.value = RECOVERY_KEY
    await sync.unlock()
    expect(sync.error.value).toBe('That recovery key is wrong. Check it against the one you saved.')
  })

  it('asks nothing of the backend for an empty secret', async () => {
    getSyncSetupStatus.mockResolvedValue({ state: 'existing', recovery: true })
    const sync = await setup()
    sync.password.value = '   '
    await sync.unlock()
    expect(unlockSyncWithPassword).not.toHaveBeenCalled()
  })

  it('forgets the shown recovery key when the section closes', async () => {
    const sync = await chosen()
    scope.stop()
    expect(sync.recoveryKey.value).toBe('')
  })
})
