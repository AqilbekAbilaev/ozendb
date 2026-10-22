import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

vi.mock('../appApi/account', () => ({
  getAccount: vi.fn(),
  getEntitlement: vi.fn(),
  startSignIn: vi.fn(),
  pollSignIn: vi.fn(),
  signOut: vi.fn(),
  deleteAccount: vi.fn(),
}))

import { getAccount, getEntitlement, startSignIn, pollSignIn, signOut, deleteAccount } from '../appApi/account'
import { entitlement, resetPremium } from '../stores/premium'
import { POLL_MS, RATE_LIMITED_MS, useAccountSignIn } from './useAccountSignIn'

const EMAIL = "zoë.o'brien+sync@exämple.com"
const REQUEST = 'r3qu.est_with-dots~and/slashes'
const ACCOUNT = { email: EMAIL, subscription: { status: 'active', renews_at: 1760000000001, ends_at: null } }
const FREE = { state: 'free' }

let scope

function signIn() {
  scope = effectScope()
  return scope.run(() => useAccountSignIn())
}

async function waiting() {
  const account = signIn()
  await vi.advanceTimersByTimeAsync(0)
  await account.start(EMAIL)
  return account
}

function failure(code) {
  return Promise.reject({ code, message: `The server said ${code}.` })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  resetPremium()
  getAccount.mockResolvedValue(null)
  getEntitlement.mockResolvedValue(FREE)
  startSignIn.mockResolvedValue({ request: REQUEST, code: '0042' })
  pollSignIn.mockResolvedValue({ state: 'waiting' })
})

afterEach(() => {
  scope?.stop()
  vi.useRealTimers()
})

describe('useAccountSignIn', () => {
  it('shows a device without a session as signed out', async () => {
    const { step } = signIn()
    await vi.advanceTimersByTimeAsync(0)
    expect(step.value).toBe('signed_out')
  })

  it('shows the account the backend reports as signed in', async () => {
    getAccount.mockResolvedValue(ACCOUNT)
    const { step, account } = signIn()
    await vi.advanceTimersByTimeAsync(0)
    expect([step.value, account.value]).toEqual(['signed_in', ACCOUNT])
  })

  it('asks for a link with the email, without surrounding spaces', async () => {
    await signIn().start(`  ${EMAIL} `)
    expect(startSignIn).toHaveBeenCalledWith(EMAIL)
  })

  it('shows the code to check against the emailed page while waiting', async () => {
    const { step, code } = await waiting()
    expect([step.value, code.value]).toEqual(['waiting', '0042'])
  })

  it('shows the backend message for an email it refuses', async () => {
    startSignIn.mockImplementation(() => failure('validation'))
    const { step, error, start } = signIn()
    await start('not an email')
    expect([step.value, error.value]).toEqual(['signed_out', 'The server said validation.'])
  })

  it('polls three seconds after the link is sent, not before', async () => {
    await waiting()
    await vi.advanceTimersByTimeAsync(POLL_MS - 1)
    expect(pollSignIn).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(pollSignIn).toHaveBeenCalledWith(REQUEST)
  })

  it('polls again three seconds after each answer', async () => {
    await waiting()
    await vi.advanceTimersByTimeAsync(3 * POLL_MS)
    expect(pollSignIn).toHaveBeenCalledTimes(3)
  })

  it('never polls while an earlier poll is still unanswered', async () => {
    pollSignIn.mockReturnValue(new Promise(() => {}))
    await waiting()
    await vi.advanceTimersByTimeAsync(10 * POLL_MS)
    expect(pollSignIn).toHaveBeenCalledTimes(1)
  })

  it('waits a minute after the server says too many polls', async () => {
    pollSignIn.mockImplementationOnce(() => failure('account_rate_limited'))
    const { notice } = await waiting()
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(notice.value).toBe('Checking again in a minute…')
    await vi.advanceTimersByTimeAsync(RATE_LIMITED_MS - 1)
    expect(pollSignIn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(pollSignIn).toHaveBeenCalledTimes(2)
  })

  it('keeps polling every three seconds while the server cannot be reached', async () => {
    pollSignIn.mockImplementation(() => failure('unreachable'))
    const { step, notice } = await waiting()
    await vi.advanceTimersByTimeAsync(3 * POLL_MS)
    expect(pollSignIn).toHaveBeenCalledTimes(3)
    expect([step.value, notice.value]).toEqual(['waiting', "Can't reach the server — still trying."])
  })

  it('stops polling once the link has expired, and says so', async () => {
    pollSignIn.mockImplementation(() => failure('sign_in_expired'))
    const { step, error } = await waiting()
    await vi.advanceTimersByTimeAsync(5 * POLL_MS)
    expect(pollSignIn).toHaveBeenCalledTimes(1)
    expect(step.value).toBe('signed_out')
    expect(error.value).toBe('This sign-in link has expired. Enter your email to start again.')
  })

  it('shows the account and refreshes Premium once the link is approved', async () => {
    pollSignIn.mockResolvedValue({ state: 'signed_in' })
    getEntitlement.mockResolvedValue({ state: 'premium', until: 1760000000002 })
    const { step, account } = await waiting()
    getAccount.mockResolvedValue(ACCOUNT)
    await vi.advanceTimersByTimeAsync(5 * POLL_MS)
    expect(pollSignIn).toHaveBeenCalledTimes(1)
    expect([step.value, account.value]).toEqual(['signed_in', ACCOUNT])
    expect(entitlement.value).toEqual({ state: 'premium', until: 1760000000002 })
  })

  it('stops polling when cancelled', async () => {
    const { step, cancel } = await waiting()
    cancel()
    await vi.advanceTimersByTimeAsync(5 * POLL_MS)
    expect(pollSignIn).not.toHaveBeenCalled()
    expect(step.value).toBe('signed_out')
  })

  it('stops polling when its owner goes away', async () => {
    await waiting()
    scope.stop()
    await vi.advanceTimersByTimeAsync(5 * POLL_MS)
    expect(pollSignIn).not.toHaveBeenCalled()
  })

  it('schedules nothing after a poll that was still running when its owner went away', async () => {
    let answer
    pollSignIn.mockReturnValueOnce(new Promise((resolve) => { answer = resolve }))
    await waiting()
    await vi.advanceTimersByTimeAsync(POLL_MS)
    scope.stop()
    answer({ state: 'waiting' })
    await vi.advanceTimersByTimeAsync(5 * POLL_MS)
    expect(pollSignIn).toHaveBeenCalledTimes(1)
  })

  it('signs out and refreshes Premium', async () => {
    getAccount.mockResolvedValue(ACCOUNT)
    entitlement.value = { state: 'premium', until: 1760000000002 }
    const account = signIn()
    await vi.advanceTimersByTimeAsync(0)
    await account.signOut()
    expect(signOut).toHaveBeenCalled()
    expect([account.step.value, account.account.value]).toEqual(['signed_out', null])
    expect(entitlement.value).toEqual(FREE)
  })
  it('deletes the account, signs out here and refreshes Premium', async () => {
    getAccount.mockResolvedValue(ACCOUNT)
    entitlement.value = { state: 'premium', until: 1760000000002 }
    const account = signIn()
    await vi.advanceTimersByTimeAsync(0)
    await account.deleteAccount()
    expect(deleteAccount).toHaveBeenCalled()
    expect([account.step.value, account.account.value]).toEqual(['signed_out', null])
    expect(entitlement.value).toEqual(FREE)
  })

  it('keeps the account and asks to sign in again when the sign-in is too old to delete it', async () => {
    getAccount.mockResolvedValue(ACCOUNT)
    deleteAccount.mockImplementation(() => failure('sign_in_again'))
    const account = signIn()
    await vi.advanceTimersByTimeAsync(0)
    await account.deleteAccount()
    expect(account.step.value).toBe('signed_in')
    expect(account.error.value).toMatch(/sign out, sign in again/i)
  })

  it('keeps the account and says to cancel the subscription before deleting it', async () => {
    getAccount.mockResolvedValue(ACCOUNT)
    deleteAccount.mockImplementation(() => failure('subscription_active'))
    const account = signIn()
    await vi.advanceTimersByTimeAsync(0)
    await account.deleteAccount()
    expect(account.step.value).toBe('signed_in')
    expect(account.error.value).toMatch(/cancel your subscription/i)
  })
})
