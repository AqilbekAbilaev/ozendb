import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { getEntitlement, getAccount, startSignIn, pollSignIn, signOut } from './account'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getEntitlement', () => {
  it('invokes get_entitlement without arguments', async () => {
    invoke.mockResolvedValue({ state: 'free' })
    await getEntitlement()
    expect(invoke).toHaveBeenCalledWith('get_entitlement')
  })
})

describe('getAccount', () => {
  it('invokes get_account without arguments', async () => {
    invoke.mockResolvedValue(null)
    await getAccount()
    expect(invoke).toHaveBeenCalledWith('get_account')
  })
})

describe('startSignIn', () => {
  it('invokes start_sign_in with the email', async () => {
    invoke.mockResolvedValue({ request: 'r3qu.est', code: '0042' })
    await startSignIn("zoë.o'brien+sync@exämple.com")
    expect(invoke).toHaveBeenCalledWith('start_sign_in', { email: "zoë.o'brien+sync@exämple.com" })
  })
})

describe('pollSignIn', () => {
  it('invokes poll_sign_in with the request', async () => {
    invoke.mockResolvedValue({ state: 'waiting' })
    await pollSignIn('r3qu.est_with-dots~and/slashes')
    expect(invoke).toHaveBeenCalledWith('poll_sign_in', { request: 'r3qu.est_with-dots~and/slashes' })
  })
})

describe('signOut', () => {
  it('invokes sign_out without arguments', async () => {
    invoke.mockResolvedValue(null)
    await signOut()
    expect(invoke).toHaveBeenCalledWith('sign_out')
  })
})
