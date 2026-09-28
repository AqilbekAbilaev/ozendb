import { describe, it, expect } from 'vitest'
import { formatCell, cellKind } from './formatCell.js'

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

describe('cellKind', () => {
  it('groups the types format_type() reports by how their cells are styled', () => {
    expect(cellKind('integer')).toBe('num')
    expect(cellKind('numeric(10,2)')).toBe('num')
    expect(cellKind('double precision')).toBe('num')
    expect(cellKind('character varying(255)')).toBe('str')
    expect(cellKind('text')).toBe('str')
    expect(cellKind('uuid')).toBe('str')
    expect(cellKind('timestamp(3) with time zone')).toBe('date')
    expect(cellKind('date')).toBe('date')
    expect(cellKind('boolean')).toBe('bool')
  })

  it('leaves arrays, JSON, enums and unknown columns unstyled', () => {
    expect(cellKind('integer[]')).toBe(null)
    expect(cellKind('jsonb')).toBe(null)
    expect(cellKind('order_status')).toBe(null)
    expect(cellKind(undefined)).toBe(null)
  })
})

describe('enum columns', () => {
  it('are their own kind whenever the column lists its labels', () => {
    expect(cellKind('merchant_status', ['active', 'blocked'])).toBe('enum')
    expect(cellKind('merchant_status')).toBe(null)
    expect(cellKind('text', [])).toBe('str')
  })
})
