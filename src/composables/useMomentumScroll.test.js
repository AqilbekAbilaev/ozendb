import { describe, it, expect } from 'vitest'
import { blendVelocity, decay, shouldFling } from './useMomentumScroll'

describe('blendVelocity', () => {
  it('follows a steady swipe towards its true speed', () => {
    let v = 0
    for (let i = 0; i < 10; i++) v = blendVelocity(v, 10, 10)  // 10px every 10ms = 1 px/ms
    expect(v).toBeCloseTo(1, 2)
  })

  it('keeps the sign of the swipe direction', () => {
    expect(blendVelocity(0, -10, 10)).toBeLessThan(0)
  })

  it('clamps a freak delta to the speed cap', () => {
    expect(blendVelocity(0, 100000, 1)).toBeLessThanOrEqual(8)
  })
})

describe('decay', () => {
  it('slows the glide down over time', () => {
    expect(decay(1, 16)).toBeLessThan(1)
    expect(decay(1, 160)).toBeLessThan(decay(1, 16))
  })

  it('reaches a stop from a fast fling in about a second', () => {
    let v = 3
    for (let t = 0; t < 1000; t += 16) v = decay(v, 16)
    expect(v).toBeLessThan(0.25)
  })
})

describe('shouldFling', () => {
  it('flings after a fast multi-event swipe', () => {
    expect(shouldFling(12, 0, 2)).toBe(true)
  })

  it('ignores a single mouse-wheel notch', () => {
    expect(shouldFling(1, 0, 5)).toBe(false)
  })

  it('ignores a swipe that had already stopped when the fingers lifted', () => {
    expect(shouldFling(20, 0, 0.1)).toBe(false)
  })
})
