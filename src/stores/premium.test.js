import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../appApi/account', () => ({ getEntitlement: vi.fn() }))

import { getEntitlement } from '../appApi/account'
import { entitlement, isPremium, refreshPremium, resetPremium } from './premium'

const PREMIUM = { state: 'premium', until: 1760604800000 }

beforeEach(() => {
  vi.resetAllMocks()
  resetPremium()
})

describe('premium store', () => {
  it('knows nothing until the backend has been asked', () => {
    expect(entitlement.value).toEqual({ state: 'unknown' })
    expect(isPremium.value).toBe(false)
  })

  it('takes the entitlement the backend reports', async () => {
    getEntitlement.mockResolvedValue(PREMIUM)
    await refreshPremium()
    expect(entitlement.value).toEqual(PREMIUM)
    expect(isPremium.value).toBe(true)
  })

  it.each(['unknown', 'free', 'expired'])('is not Premium when the state is %s', async (state) => {
    getEntitlement.mockResolvedValue({ state })
    await refreshPremium()
    expect(isPremium.value).toBe(false)
  })

  it('keeps the last known entitlement when the backend cannot be asked', async () => {
    getEntitlement.mockResolvedValue(PREMIUM)
    await refreshPremium()
    getEntitlement.mockRejectedValue(new Error('offline'))
    await refreshPremium()
    expect(entitlement.value).toEqual(PREMIUM)
  })
})
