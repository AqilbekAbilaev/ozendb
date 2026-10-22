import { ref, onScopeDispose } from 'vue'
import * as accountApi from '../appApi/account'
import { refreshPremium } from '../stores/premium'
import { errCode, errMessage, errText } from '../utils/errors'

// The account on this device, and signing in by email: ask for a link, show its code,
// then poll until someone approves it (the polling rules are in appApi/account.js).
// Waiting ends when the owning component unmounts, so closing the dialog abandons it.

export const POLL_MS = 3 * 1000
export const RATE_LIMITED_MS = 60 * 1000

const MESSAGES = {
  sign_in_expired: 'This sign-in link has expired. Enter your email to start again.',
  account_rate_limited: 'Too many attempts. Try again in a minute.',
  unreachable: "Can't reach the OzenDB server. Check your internet connection.",
  account_server: 'The OzenDB server had a problem. Try again later.',
  signed_out: 'You were signed out. Sign in again.',
  sign_in_again: 'For your safety, deleting needs a recent sign-in. Sign out, sign in again, then delete within ten minutes.',
  subscription_active: 'Cancel your subscription first, with Manage subscription, then delete the account.',
}

export function accountErrorText(e) {
  const code = errCode(e)
  if (code === 'keychain') return `OzenDB could not use the system keychain. ${errMessage(e)}`
  return MESSAGES[code] || errText(e)
}

export function useAccountSignIn() {
  // 'loading' | 'signed_out' | 'sending' | 'waiting' | 'signed_in'
  const step = ref('loading')
  const account = ref(null)
  const code = ref('')
  const notice = ref('')
  const error = ref('')
  const signingOut = ref(false)
  const deleting = ref(false)

  // The sign-in request being polled; null when not waiting. A poll whose request is no
  // longer this one was cancelled while it ran, and schedules nothing.
  let request = null
  let timer = null
  let disposed = false

  function stopWaiting() {
    clearTimeout(timer)
    timer = null
    request = null
    notice.value = ''
  }

  async function load() {
    try {
      account.value = await accountApi.getAccount()
      step.value = account.value ? 'signed_in' : 'signed_out'
    } catch (e) {
      error.value = accountErrorText(e)
      step.value = 'signed_out'
    }
  }

  async function start(email) {
    stopWaiting()
    error.value = ''
    step.value = 'sending'
    try {
      const started = await accountApi.startSignIn(email.trim())
      if (disposed) return
      request = started.request
      code.value = started.code
      step.value = 'waiting'
      timer = setTimeout(poll, POLL_MS)
    } catch (e) {
      error.value = accountErrorText(e)
      step.value = 'signed_out'
    }
  }

  async function poll() {
    const polled = request
    let answer
    try {
      answer = await accountApi.pollSignIn(polled)
    } catch (e) {
      if (request === polled && !disposed) pollFailed(e)
      return
    }
    // Approved is approved, even after Cancel: the backend has already kept the session.
    if (answer.state === 'signed_in') {
      stopWaiting()
      await Promise.all([refreshPremium(), load()])
      return
    }
    if (request !== polled || disposed) return
    notice.value = ''
    timer = setTimeout(poll, POLL_MS)
  }

  function pollFailed(e) {
    const failure = errCode(e)
    if (failure === 'account_rate_limited') {
      notice.value = 'Checking again in a minute…'
      timer = setTimeout(poll, RATE_LIMITED_MS)
    } else if (failure === 'unreachable') {
      notice.value = "Can't reach the server — still trying."
      timer = setTimeout(poll, POLL_MS)
    } else {
      stopWaiting()
      error.value = accountErrorText(e)
      step.value = 'signed_out'
    }
  }

  function cancel() {
    stopWaiting()
    step.value = 'signed_out'
  }

  async function signOut() {
    error.value = ''
    signingOut.value = true
    try {
      await accountApi.signOut()
      account.value = null
      step.value = 'signed_out'
    } catch (e) {
      error.value = accountErrorText(e)
    } finally {
      signingOut.value = false
    }
    await refreshPremium()
  }

  async function deleteAccount() {
    error.value = ''
    deleting.value = true
    try {
      await accountApi.deleteAccount()
      account.value = null
      step.value = 'signed_out'
    } catch (e) {
      error.value = accountErrorText(e)
      if (errCode(e) === 'signed_out') {
        account.value = null
        step.value = 'signed_out'
      }
    } finally {
      deleting.value = false
    }
    await refreshPremium()
  }

  onScopeDispose(() => {
    disposed = true
    stopWaiting()
  })

  load()

  return { step, account, code, notice, error, signingOut, deleting, start, cancel, signOut, deleteAccount }
}
