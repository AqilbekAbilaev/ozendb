import { ref, onScopeDispose } from 'vue'
import * as setupApi from '../appApi/syncSetup'
import { entitlement } from '../stores/premium'
import { errCode } from '../utils/errors'
import { syncPasswordProblem } from '../utils/syncPassword'
import { accountErrorText } from './useAccountSignIn'

// Setting sync up on this device, once signed in (the calls are in appApi/syncSetup.js).
// The typed password, confirmation and recovery key live here only until the call that
// needs them returns, and the recovery key shown on a first device only until the user
// says they saved it, so none of them outlive their step.

const MESSAGES = {
  wrong_sync_password: 'That sync password is wrong.',
  wrong_recovery_key: 'That recovery key is wrong. Check it against the one you saved.',
  not_premium: 'Syncing needs OzenDB Premium.',
  sync_set_up_elsewhere: 'Another device set up sync for this account first. Enter its sync password to join it.',
  sync_not_set_up: 'The new keys were lost. Choose your sync password again.',
}

export function setupErrorText(e) {
  return MESSAGES[errCode(e)] || accountErrorText(e)
}

export function useSyncSetup() {
  // 'checking' | 'premium_needed' | 'choose' | 'recovery_key' | 'finishing' | 'retry'
  // | 'unlock' | 'set_up' | 'failed'
  const step = ref('checking')
  // Whether a recovery key can unlock the account's sync, on another device.
  const recoveryAvailable = ref(false)
  // On another device: unlock with the 'password' or the 'recovery_key'.
  const unlockWith = ref('password')
  const password = ref('')
  const confirmation = ref('')
  const typedRecoveryKey = ref('')
  const recoveryKey = ref('')
  // The user's word that they saved the recovery key shown; the upload waits for it.
  const recoveryKeySaved = ref(false)
  const busy = ref(false)
  const error = ref('')

  function clearTyped() {
    password.value = ''
    confirmation.value = ''
    typedRecoveryKey.value = ''
  }

  async function check() {
    if (entitlement.value.state === 'free') {
      step.value = 'premium_needed'
      return
    }
    step.value = 'checking'
    try {
      const status = await setupApi.getSyncSetupStatus()
      if (status.state === 'set_up') step.value = 'set_up'
      else if (status.state === 'new') step.value = 'choose'
      else {
        recoveryAvailable.value = status.recovery
        unlockWith.value = 'password'
        step.value = 'unlock'
      }
    } catch (e) {
      if (errCode(e) === 'not_premium') {
        step.value = 'premium_needed'
      } else {
        error.value = setupErrorText(e)
        step.value = 'failed'
      }
    }
  }

  function checkAgain() {
    error.value = ''
    return check()
  }

  // Runs `call`, showing its failure; answers the failure's code, or undefined when it
  // succeeded.
  async function attempt(call) {
    error.value = ''
    busy.value = true
    try {
      await call()
      return undefined
    } catch (e) {
      error.value = setupErrorText(e)
      return errCode(e) ?? 'unknown'
    } finally {
      busy.value = false
      clearTyped()
    }
  }

  async function choose() {
    const problem = syncPasswordProblem(password.value, confirmation.value)
    if (problem) {
      error.value = problem
      return
    }
    const typed = password.value
    const failure = await attempt(async () => { recoveryKey.value = await setupApi.createSyncKeys(typed) })
    if (failure) return
    recoveryKeySaved.value = false
    step.value = 'recovery_key'
  }

  // After the user saved the recovery key, or to try the upload again.
  async function finish() {
    if (step.value === 'recovery_key' && !recoveryKeySaved.value) return
    recoveryKey.value = ''
    step.value = 'finishing'
    const failure = await attempt(setupApi.finishSyncSetup)
    if (!failure) step.value = 'set_up'
    // The status check leaves the error shown unless it fails itself.
    else if (failure === 'sync_set_up_elsewhere') await check()
    else step.value = failure === 'sync_not_set_up' ? 'choose' : 'retry'
  }

  async function unlock() {
    const secret = unlockWith.value === 'password' ? password.value : typedRecoveryKey.value
    if (!secret.trim()) return
    const call = unlockWith.value === 'password'
      ? () => setupApi.unlockSyncWithPassword(secret)
      : () => setupApi.unlockSyncWithRecoveryKey(secret)
    if (!(await attempt(call))) step.value = 'set_up'
  }

  onScopeDispose(() => {
    clearTyped()
    recoveryKey.value = ''
  })

  check()

  return {
    step, recoveryAvailable, unlockWith, password, confirmation, typedRecoveryKey,
    recoveryKey, recoveryKeySaved, busy, error, checkAgain, choose, finish, unlock,
  }
}
