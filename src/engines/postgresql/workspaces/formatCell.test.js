import { describe, it, expect } from 'vitest'
import { formatCell } from './formatCell.js'

describe('formatCell', () => {
  it('shows scalars as text and structured values as JSON', () => {
    expect(formatCell('Ada')).toBe('Ada')
    expect(formatCell(42)).toBe('42')
    expect(formatCell(false)).toBe('false')
    expect(formatCell({ a: [1, 2] })).toBe('{"a":[1,2]}')
    expect(formatCell(['x'])).toBe('["x"]')
  })

  it('marks SQL NULL rather than showing an empty cell', () => {
    expect(formatCell(null)).toBe('NULL')
  })
})
