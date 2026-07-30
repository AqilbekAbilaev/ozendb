import { describe, it, expect } from 'vitest'
import { ZOOM_LEVELS, DEFAULT_ZOOM, nearestZoom, stepZoom } from './zoom'

describe('nearestZoom', () => {
  it('keeps a value already on the ladder', () => {
    for (const level of ZOOM_LEVELS) expect(nearestZoom(level)).toBe(level)
  })

  it('snaps an off-ladder value to the closest rung', () => {
    expect(nearestZoom(1.05)).toBe(1)
    expect(nearestZoom(1.2)).toBe(1.25)
    expect(nearestZoom(0.7)).toBe(0.67)
  })

  it('clamps beyond either end', () => {
    expect(nearestZoom(5)).toBe(2)
    expect(nearestZoom(0.01)).toBe(0.5)
  })

  // A hand-edited settings.json shouldn't be able to blank the UI.
  it('falls back to the default for junk', () => {
    for (const junk of [undefined, null, NaN, 'big', {}]) {
      expect(nearestZoom(junk)).toBe(DEFAULT_ZOOM)
    }
  })
})

describe('stepZoom', () => {
  it('steps one rung in and out', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1, -1)).toBe(0.9)
  })

  it('stops at the maximum instead of overshooting', () => {
    expect(stepZoom(2, 1)).toBe(2)
  })

  it('stops at the minimum instead of overshooting', () => {
    expect(stepZoom(0.5, -1)).toBe(0.5)
  })

  it('walks the whole ladder without skipping a rung', () => {
    let value = ZOOM_LEVELS[0]
    const seen = [value]
    for (let i = 0; i < ZOOM_LEVELS.length - 1; i++) {
      value = stepZoom(value, 1)
      seen.push(value)
    }
    expect(seen).toEqual(ZOOM_LEVELS)
  })

  it('snaps an off-ladder current value before stepping', () => {
    expect(stepZoom(1.05, 1)).toBe(1.1)
    expect(stepZoom(1.05, -1)).toBe(0.9)
  })
})
