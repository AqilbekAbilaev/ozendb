import { describe, it, expect, vi, afterEach } from 'vitest'
import { fmtBytes, fmtBytesExact, fmtClock, cellText } from './format'

describe('fmtBytesExact', () => {
  it('follows the human size with the exact byte count', () => {
    // fmtBytes drops the decimal at 10 and above, so this reads 93 MB, not 92.7 MB —
    // the exact figure beside it is what the parenthetical is for.
    expect(fmtBytesExact(97215550)).toBe('93 MB (97,215,550)')
    expect(fmtBytesExact(1576960)).toBe('1.5 MB (1,576,960)')
  })

  it('omits the parenthetical when the human size is already the byte count', () => {
    expect(fmtBytesExact(291)).toBe('291 B')
    expect(fmtBytesExact(0)).toBe('0 B')
  })

  it('returns the empty marker for a missing value', () => {
    expect(fmtBytesExact(null)).toBe('—')
    expect(fmtBytesExact(undefined)).toBe('—')
  })
})

describe('fmtClock', () => {
  afterEach(() => vi.useRealTimers())

  it('stamps the wall clock to the second', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 10, 13, 33, 22))
    expect(fmtClock()).toBe('10 Aug 2026 13:33:22')
  })
})

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
