import { describe, it, expect } from 'vitest'
import {
  valueToClipboard,
  valueToEjson,
  documentToClipboard,
  fieldPath,
} from './clipboardCopy'

describe('valueToClipboard (shell-style cell copy)', () => {
  it('copies primitives as bare text', () => {
    expect(valueToClipboard('hello')).toBe('hello')
    expect(valueToClipboard(42)).toBe('42')
    expect(valueToClipboard(true)).toBe('true')
    expect(valueToClipboard(null)).toBe('')
    expect(valueToClipboard(undefined)).toBe('')
  })

  it('unwraps common Extended-JSON scalars', () => {
    expect(valueToClipboard({ $oid: '507f1f77bcf86cd799439011' })).toBe('507f1f77bcf86cd799439011')
    expect(valueToClipboard({ $numberLong: '9007199254740993' })).toBe('9007199254740993')
    expect(valueToClipboard({ $numberDecimal: '3.14' })).toBe('3.14')
    expect(valueToClipboard({ $date: '2020-01-31T00:00:00Z' })).toBe('2020-01-31T00:00:00Z')
    expect(valueToClipboard({ $date: { $numberLong: '1704067200000' } })).toBe(
      new Date(1704067200000).toISOString(),
    )
  })

  it('falls back to pretty JSON for nested objects/arrays', () => {
    expect(valueToClipboard({ a: 1 })).toBe(JSON.stringify({ a: 1 }, null, 2))
    expect(valueToClipboard([1, 2])).toBe(JSON.stringify([1, 2], null, 2))
  })
})

describe('valueToEjson (Copy Value)', () => {
  it('copies primitives bare', () => {
    expect(valueToEjson('hi')).toBe('hi')
    expect(valueToEjson(7)).toBe('7')
    expect(valueToEjson(false)).toBe('false')
    expect(valueToEjson(null)).toBe('null')
  })

  it('keeps non-primitive types as valid Extended JSON', () => {
    const oid = { $oid: '507f1f77bcf86cd799439011' }
    expect(valueToEjson(oid)).toBe(JSON.stringify(oid, null, 2))
    expect(JSON.parse(valueToEjson(oid))).toEqual(oid)

    const date = { $date: { $numberLong: '1704067200000' } }
    expect(JSON.parse(valueToEjson(date))).toEqual(date)

    const nested = { tags: ['a', 'b'], n: { $numberInt: '3' } }
    expect(JSON.parse(valueToEjson(nested))).toEqual(nested)
  })
})

describe('documentToClipboard', () => {
  it('serializes the whole document as pretty Extended JSON', () => {
    const doc = { _id: { $oid: '507f1f77bcf86cd799439011' }, name: 'Jo' }
    expect(documentToClipboard(doc)).toBe(JSON.stringify(doc, null, 2))
    expect(JSON.parse(documentToClipboard(doc))).toEqual(doc)
  })
})

describe('fieldPath', () => {
  it('joins the drill path and field name with dots', () => {
    expect(fieldPath([], 'city')).toBe('city')
    expect(fieldPath(['address'], 'city')).toBe('address.city')
    expect(fieldPath(['a', 'b'], 'c')).toBe('a.b.c')
  })

  it('tolerates a missing drill path', () => {
    expect(fieldPath(null, 'x')).toBe('x')
    expect(fieldPath(undefined, 'x')).toBe('x')
  })
})
