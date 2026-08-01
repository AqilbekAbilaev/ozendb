import { describe, it, expect } from 'vitest'
import { guessType, formatCell, columns, getAtPath } from './resultGrid'

describe('guessType', () => {
  it('classifies _id and $oid as id', () => {
    expect(guessType('_id', 'anything')).toBe('id')
    expect(guessType('ref', { $oid: '507f1f77bcf86cd799439011' })).toBe('id')
  })

  it('classifies the Extended JSON wrappers', () => {
    expect(guessType('at', { $date: '2026-01-01T00:00:00Z' })).toBe('date')
    expect(guessType('amount', { $numberDecimal: '10.5' })).toBe('decimal')
    expect(guessType('count', { $numberLong: '9007199254740993' })).toBe('num')
  })

  // The reason decimal/int64 are called out above: as 'obj' the cell would drill in
  // instead of letting you edit it.
  it('does not fall through to obj for wrapped scalars', () => {
    expect(guessType('amount', { $numberDecimal: '10.5' })).not.toBe('obj')
    expect(guessType('count', { $numberLong: '1' })).not.toBe('obj')
  })

  it('classifies plain JS values', () => {
    expect(guessType('n', 42)).toBe('num')
    expect(guessType('b', true)).toBe('bool')
    expect(guessType('s', 'hi')).toBe('str')
    expect(guessType('nothing', null)).toBe('null')
    expect(guessType('missing', undefined)).toBe('null')
    expect(guessType('list', [1, 2])).toBe('obj')
    expect(guessType('doc', { a: 1 })).toBe('obj')
  })
})

describe('formatCell', () => {
  it('renders empty for null and undefined', () => {
    expect(formatCell('k', null)).toBe('')
    expect(formatCell('k', undefined)).toBe('')
  })

  it('unwraps Extended JSON scalars', () => {
    expect(formatCell('k', { $oid: 'abc' })).toBe('abc')
    expect(formatCell('k', { $numberLong: '5' })).toBe('5')
    expect(formatCell('k', { $numberDecimal: '10.5' })).toBe('10.5')
  })

  it('renders dates from either shape', () => {
    expect(formatCell('k', { $date: '2026-01-01T00:00:00Z' })).toBe('2026-01-01T00:00:00Z')
    expect(formatCell('k', { $date: { $numberLong: '0' } })).toBe('1970-01-01T00:00:00.000Z')
  })

  it('summarises arrays and objects rather than inlining them', () => {
    expect(formatCell('k', [1, 2, 3])).toBe('Array(3)')
    expect(formatCell('k', { a: 1 })).toBe('{…}')
  })

  it('passes strings, numbers and booleans through', () => {
    expect(formatCell('k', 'text')).toBe('text')
    expect(formatCell('k', 0)).toBe('0')
    expect(formatCell('k', false)).toBe('false')
  })
})

describe('columns', () => {
  it('is empty for no results', () => {
    expect(columns([])).toEqual([])
    expect(columns(null)).toEqual([])
    expect(columns(undefined)).toEqual([])
  })

  it('unions every document key and pins _id first', () => {
    expect(columns([{ _id: 1, b: 2 }, { a: 3 }])).toEqual(['_id', 'a', 'b'])
  })

  it('sorts the rest alphabetically and omits _id when absent', () => {
    expect(columns([{ c: 1, a: 2, b: 3 }])).toEqual(['a', 'b', 'c'])
  })

  // A drilled-into array has numeric keys; string sort would put 10 before 9.
  it('sorts an all-numeric key set numerically', () => {
    expect(columns([{ 0: 'a', 9: 'b', 10: 'c' }])).toEqual(['0', '9', '10'])
  })
})

describe('getAtPath', () => {
  const doc = { a: { b: { c: 42 } }, list: [{ x: 1 }] }

  it('returns the document itself for an empty path', () => {
    expect(getAtPath(doc, [])).toBe(doc)
  })

  it('walks nested keys, including array indices', () => {
    expect(getAtPath(doc, ['a', 'b', 'c'])).toBe(42)
    expect(getAtPath(doc, ['list', '0', 'x'])).toBe(1)
  })

  it('returns undefined when a level is missing or not an object', () => {
    expect(getAtPath(doc, ['a', 'nope', 'c'])).toBeUndefined()
    expect(getAtPath(doc, ['a', 'b', 'c', 'deeper'])).toBeUndefined()
    expect(getAtPath(null, ['a'])).toBeUndefined()
  })
})
