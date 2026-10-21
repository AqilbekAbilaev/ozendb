import { describe, it, expect } from 'vitest'
import { planText } from './accountPlan'

// Midday UTC, so the date reads the same in any time zone the tests run in.
const NOV_16 = Date.UTC(2026, 10, 16, 12)
const PREMIUM = { state: 'premium', until: NOV_16 }

describe('planText', () => {
  it('gives the renewal date of a subscription that renews', () => {
    expect(planText(PREMIUM, { status: 'active', renews_at: NOV_16, ends_at: null })).toBe('Premium, renews 16 Nov 2026')
  })

  it('gives the end date of a cancelled subscription, not its renewal date', () => {
    expect(planText(PREMIUM, { status: 'cancelled', renews_at: NOV_16 - 1, ends_at: NOV_16 })).toBe('Premium, ends 16 Nov 2026')
  })

  it('names Premium alone when the subscription gives no date', () => {
    expect(planText(PREMIUM, null)).toBe('Premium')
  })

  it('says Premium has expired once the entitlement has lapsed, whatever the subscription says', () => {
    expect(planText({ state: 'expired' }, { status: 'active', renews_at: NOV_16, ends_at: null })).toBe('Premium has expired')
  })

  it('names the free plan', () => {
    expect(planText({ state: 'free' }, null)).toBe('Free')
  })

  it('admits the plan is not known before the server has answered', () => {
    expect(planText({ state: 'unknown' }, null)).toBe('Plan not known yet')
  })
})
