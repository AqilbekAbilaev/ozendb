import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../appApi/account', () => ({ getEntitlement: vi.fn() }))

import { getEntitlement } from '../appApi/account'
import { entitlement, isPremium, refreshPremium, resetPremium } from './premium'

const NOW = 1760000000000
const HOUR = 60 * 60 * 1000
const PREMIUM = { state: 'premium', until: NOW + 2 * HOUR }

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ now: NOW })
  resetPremium()
})

afterEach(() => {
  vi.useRealTimers()
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

  it('keeps the last known entitlement and passes on the error when the backend cannot be asked', async () => {
    getEntitlement.mockResolvedValue(PREMIUM)
    await refreshPremium()
    getEntitlement.mockRejectedValue(new Error('offline'))
    await expect(refreshPremium()).rejects.toThrow('offline')
    expect(entitlement.value).toEqual(PREMIUM)
  })

  it('asks again when a Premium answer runs out', async () => {
    getEntitlement.mockResolvedValueOnce(PREMIUM).mockResolvedValueOnce({ state: 'expired' })
    await refreshPremium()
    await vi.advanceTimersByTimeAsync(2 * HOUR - 1)
    expect(isPremium.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(entitlement.value).toEqual({ state: 'expired' })
  })

  it('asks again within a minute of waking when the computer slept past the end', async () => {
    getEntitlement.mockResolvedValueOnce(PREMIUM).mockResolvedValueOnce({ state: 'expired' })
    await refreshPremium()
    // Asleep: the clock moves on, but timers do not run.
    vi.setSystemTime(NOW + 10 * HOUR)
    await vi.advanceTimersByTimeAsync(60 * 1000)
    expect(entitlement.value).toEqual({ state: 'expired' })
  })

  it('does not ask again after an answer that is not Premium', async () => {
    getEntitlement.mockResolvedValue({ state: 'free' })
    await refreshPremium()
    await vi.advanceTimersByTimeAsync(30 * 24 * HOUR)
    expect(getEntitlement).toHaveBeenCalledTimes(1)
  })
})
