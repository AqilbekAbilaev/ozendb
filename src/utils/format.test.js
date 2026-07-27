import { describe, it, expect } from 'vitest'
import { fmtBytes, cellText } from './format'

describe('fmtBytes', () => {
  it('reports raw bytes below 1 KB', () => {
    expect(fmtBytes(0)).toBe('0 B')
    expect(fmtBytes(999)).toBe('999 B')
    expect(fmtBytes(1023)).toBe('1023 B')
  })

  it('steps up a unit every 1024', () => {
    expect(fmtBytes(1024)).toBe('1.0 KB')
    expect(fmtBytes(1024 ** 2)).toBe('1.0 MB')
    expect(fmtBytes(1024 ** 3)).toBe('1.0 GB')
    expect(fmtBytes(1024 ** 4)).toBe('1.0 TB')
  })

  it('drops the decimal at 10 and above', () => {
    expect(fmtBytes(1536)).toBe('1.5 KB')
    expect(fmtBytes(9.4 * 1024)).toBe('9.4 KB')
    expect(fmtBytes(12 * 1024)).toBe('12 KB')
  })

  it('saturates at TB rather than inventing a unit', () => {
    expect(fmtBytes(5000 * 1024 ** 4)).toBe('5000 TB')
  })

  it('returns the empty marker for null and undefined', () => {
    expect(fmtBytes(null)).toBe('—')
    expect(fmtBytes(undefined)).toBe('—')
    expect(fmtBytes(null, 'n/a')).toBe('n/a')
    expect(fmtBytes(null, null)).toBeNull()
  })
})

describe('cellText', () => {
  it('renders scalars as strings', () => {
    expect(cellText('x')).toBe('x')
    expect(cellText(0)).toBe('0')
    expect(cellText(false)).toBe('false')
  })

  it('blanks null and undefined', () => {
    expect(cellText(null)).toBe('')
    expect(cellText(undefined)).toBe('')
  })

  it('renders objects and arrays as compact JSON', () => {
    expect(cellText({ $oid: 'abc' })).toBe('{"$oid":"abc"}')
    expect(cellText([1, 2])).toBe('[1,2]')
  })
})
