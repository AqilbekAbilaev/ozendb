import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

vi.mock('../appApi/syncSetup', () => ({
  changeSyncPassword: vi.fn(),
  replaceRecoveryKey: vi.fn(),
}))

import { changeSyncPassword, replaceRecoveryKey } from '../appApi/syncSetup'
import { useSyncKeys } from './useSyncKeys'

const PASSWORD = 'nëw pässword/2 — long enough'
const RECOVERY_KEY = '00FQ-X055-RFZM-568G-BBKK-SP3B-Y3'

let scope

function keys() {
  scope = effectScope()
  return scope.run(() => useSyncKeys())
}

function failure(code) {
  return Promise.reject({ code, message: `The backend said ${code}.` })
}

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  scope?.stop()
})

describe('useSyncKeys', () => {
  it('changes the sync password once typed twice, and forgets what was typed', async () => {
    changeSyncPassword.mockResolvedValue(null)
    const k = keys()
    k.startPasswordChange()
    k.password.value = PASSWORD
    k.confirmation.value = PASSWORD
    await k.changePassword()
    expect(changeSyncPassword).toHaveBeenCalledWith(PASSWORD)
    expect([k.step.value, k.password.value, k.confirmation.value]).toEqual(['idle', '', ''])
    expect(k.notice.value).toMatch(/password changed/i)
  })

  it('refuses two passwords that differ without asking the backend', async () => {
    const k = keys()
    k.startPasswordChange()
    k.password.value = PASSWORD
    k.confirmation.value = `${PASSWORD}!`
    await k.changePassword()
    expect(changeSyncPassword).not.toHaveBeenCalled()
    expect(k.error.value).toMatch(/do not match/)
  })

  it('stays on the form and says why when the change fails', async () => {
    changeSyncPassword.mockImplementation(() => failure('unreachable'))
    const k = keys()
    k.startPasswordChange()
    k.password.value = PASSWORD
    k.confirmation.value = PASSWORD
    await k.changePassword()
    expect(k.step.value).toBe('password')
    expect(k.error.value).toMatch(/reach the OzenDB server/)
  })

  it('shows a new recovery key until the user says it is saved', async () => {
    replaceRecoveryKey.mockResolvedValue(RECOVERY_KEY)
    const k = keys()
    k.askForRecoveryKey()
    await k.replaceRecoveryKey()
    expect([k.step.value, k.recoveryKey.value]).toEqual(['recovery_key', RECOVERY_KEY])
    k.doneWithRecoveryKey()
    expect(k.step.value).toBe('recovery_key')
    k.recoveryKeySaved.value = true
    k.doneWithRecoveryKey()
    expect([k.step.value, k.recoveryKey.value]).toEqual(['idle', ''])
  })

  it('keeps the old recovery key when making a new one fails', async () => {
    replaceRecoveryKey.mockImplementation(() => failure('sync_kept_changing'))
    const k = keys()
    k.askForRecoveryKey()
    await k.replaceRecoveryKey()
    expect([k.step.value, k.recoveryKey.value]).toEqual(['recovery_confirm', ''])
    expect(k.error.value).not.toBe('')
  })

  it('cancels back to the actions and clears what was typed', () => {
    const k = keys()
    k.startPasswordChange()
    k.password.value = PASSWORD
    k.cancel()
    expect([k.step.value, k.password.value]).toEqual(['idle', ''])
  })
})
