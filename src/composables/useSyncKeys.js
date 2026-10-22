import { ref, onScopeDispose } from 'vue'
import * as setupApi from '../appApi/syncSetup'
import { syncPasswordProblem } from '../utils/syncPassword'
import { setupErrorText } from './useSyncSetup'

// Changing what unlocks the account's sync key, once sync is set up here: a new sync
// password, or a new recovery key shown once. The key itself stays the same, so devices
// already syncing carry on. What was typed, and the recovery key shown, live only until
// their step ends.

export function useSyncKeys() {
  // 'idle' | 'password' | 'recovery_confirm' | 'recovery_key'
  const step = ref('idle')
  const password = ref('')
  const confirmation = ref('')
  const recoveryKey = ref('')
  const recoveryKeySaved = ref(false)
  const busy = ref(false)
  const error = ref('')
  const notice = ref('')

  function clearTyped() {
    password.value = ''
    confirmation.value = ''
  }

  function begin(next) {
    error.value = ''
    notice.value = ''
    step.value = next
  }

  // Runs `call`, showing its failure; answers whether it succeeded.
  async function attempt(call) {
    error.value = ''
    busy.value = true
    try {
      await call()
      return true
    } catch (e) {
      error.value = setupErrorText(e)
      return false
    } finally {
      busy.value = false
    }
  }

  function startPasswordChange() {
    begin('password')
  }

  async function changePassword() {
    const problem = syncPasswordProblem(password.value, confirmation.value)
    if (problem) {
      error.value = problem
      return
    }
    const typed = password.value
    const changed = await attempt(() => setupApi.changeSyncPassword(typed))
    clearTyped()
    if (!changed) return
    step.value = 'idle'
    notice.value = 'Sync password changed. Use it to set up sync on your other devices from now on.'
  }

  function askForRecoveryKey() {
    begin('recovery_confirm')
  }

  async function replaceRecoveryKey() {
    if (!(await attempt(async () => { recoveryKey.value = await setupApi.replaceRecoveryKey() }))) return
    recoveryKeySaved.value = false
    step.value = 'recovery_key'
  }

  function doneWithRecoveryKey() {
    if (!recoveryKeySaved.value) return
    recoveryKey.value = ''
    step.value = 'idle'
    notice.value = 'Recovery key replaced. The old one no longer works.'
  }

  function cancel() {
    clearTyped()
    begin('idle')
  }

  onScopeDispose(() => {
    clearTyped()
    recoveryKey.value = ''
  })

  return {
    step, password, confirmation, recoveryKey, recoveryKeySaved, busy, error, notice,
    startPasswordChange, changePassword, askForRecoveryKey, replaceRecoveryKey, doneWithRecoveryKey, cancel,
  }
}
