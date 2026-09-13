import { describe, it, expect, vi, beforeEach } from 'vitest'
import { THEME_KEY, normalizedTheme, prePaintTheme, writeThemeMirror } from './themeMirror'

function stubEnv(stored) {
  const store = { [THEME_KEY]: stored }
  vi.stubGlobal('document', { documentElement: { dataset: {} } })
  vi.stubGlobal('localStorage', {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: vi.fn((key, value) => { store[key] = value }),
  })
  return store
}

beforeEach(() => { vi.unstubAllGlobals() })

describe('normalizedTheme', () => {
  it('keeps light and falls back to dark for anything else', () => {
    expect(normalizedTheme('light')).toBe('light')
    expect(normalizedTheme('dark')).toBe('dark')
    expect(normalizedTheme(undefined)).toBe('dark')
    expect(normalizedTheme('neon')).toBe('dark')
  })
})

describe('prePaintTheme', () => {
  it('paints the stored theme', () => {
    stubEnv('light')
    prePaintTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('paints dark when nothing is stored', () => {
    stubEnv(undefined)
    prePaintTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('never writes the mirror back', () => {
    stubEnv(undefined)
    prePaintTheme()
    expect(localStorage.setItem).not.toHaveBeenCalled()
  })

  it('paints dark rather than throwing when reading storage is blocked', () => {
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
    expect(() => prePaintTheme()).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('writeThemeMirror', () => {
  it('paints and stores the normalized theme, and returns it', () => {
    stubEnv('dark')
    expect(writeThemeMirror('light')).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.setItem).toHaveBeenCalledWith(THEME_KEY, 'light')
  })

  it('normalizes an unknown value before storing it', () => {
    stubEnv('light')
    expect(writeThemeMirror('neon')).toBe('dark')
    expect(localStorage.setItem).toHaveBeenCalledWith(THEME_KEY, 'dark')
  })

  it('still paints and returns the theme when writing to storage is blocked', () => {
    vi.stubGlobal('document', { documentElement: { dataset: {} } })
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('blocked') } })
    expect(writeThemeMirror('light')).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
