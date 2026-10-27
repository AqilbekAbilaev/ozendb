import { describe, it, expect } from 'vitest'
import {
  buildTypedValue,
  detectType,
  displayRaw,
  inspectField,
  setFieldValue,
  addFieldValue,
  removeField,
  renameField,
} from './docEdit'

describe('buildTypedValue', () => {
  it('builds each supported BSON type', () => {
    expect(buildTypedValue('String', 'hi')).toBe('hi')
    expect(buildTypedValue('Int32', '42')).toEqual({ $numberInt: '42' })
    expect(buildTypedValue('Int64', '9007199254740993')).toEqual({ $numberLong: '9007199254740993' })
    expect(buildTypedValue('Double', '3.5')).toEqual({ $numberDouble: '3.5' })
    expect(buildTypedValue('Boolean', 'true')).toBe(true)
    expect(buildTypedValue('Boolean', 'false')).toBe(false)
    expect(buildTypedValue('Null', '')).toBe(null)
    expect(buildTypedValue('ObjectId', '507f1f77bcf86cd799439011')).toEqual({ $oid: '507f1f77bcf86cd799439011' })
    expect(buildTypedValue('Date', '2020-01-31T00:00:00Z')).toEqual({ $date: { $numberLong: String(Date.parse('2020-01-31T00:00:00Z')) } })
    expect(buildTypedValue('JSON', '[1,2,3]')).toEqual([1, 2, 3])
  })

  it('rejects invalid input with a helpful message', () => {
    expect(() => buildTypedValue('Int32', 'x')).toThrow(/whole number/)
    expect(() => buildTypedValue('Double', '')).toThrow(/number/)
    expect(() => buildTypedValue('Boolean', 'yes')).toThrow(/true or false/)
    expect(() => buildTypedValue('ObjectId', 'abc')).toThrow(/24 hex/)
    expect(() => buildTypedValue('Date', 'not-a-date')).toThrow(/valid date/)
    expect(() => buildTypedValue('JSON', '{bad')).toThrow(/Invalid JSON/)
  })
})

describe('detectType / displayRaw', () => {
  it('detects the type of Extended-JSON values', () => {
    expect(detectType('s')).toBe('String')
    expect(detectType(3)).toBe('Int32')
    expect(detectType(3.5)).toBe('Double')
    expect(detectType(true)).toBe('Boolean')
    expect(detectType(null)).toBe('Null')
    expect(detectType({ $oid: 'a' })).toBe('ObjectId')
    expect(detectType({ $date: { $numberLong: '0' } })).toBe('Date')
    expect(detectType({ $numberLong: '5' })).toBe('Int64')
    expect(detectType({ nested: 1 })).toBe('JSON')
    expect(detectType([1, 2])).toBe('JSON')
  })

  it('round-trips a value through displayRaw + buildTypedValue', () => {
    const oid = { $oid: '507f1f77bcf86cd799439011' }
    expect(buildTypedValue('ObjectId', displayRaw(oid))).toEqual(oid)
    expect(buildTypedValue('Int32', displayRaw(7))).toEqual({ $numberInt: '7' })
  })
})

describe('inspectField', () => {
  it('reports the type and raw value at a path', () => {
    const doc = { _id: { $oid: 'a' }, addr: { city: 'NYC' } }
    expect(inspectField(doc, [], 'addr')).toEqual({ type: 'JSON', raw: JSON.stringify({ city: 'NYC' }, null, 2) })
    expect(inspectField(doc, ['addr'], 'city')).toEqual({ type: 'String', raw: 'NYC' })
  })
})

describe('setFieldValue', () => {
  it('sets a top-level field without mutating the original', () => {
    const doc = { _id: 1, name: 'a' }
    const out = setFieldValue(doc, [], 'name', 'b')
    expect(out.name).toBe('b')
    expect(doc.name).toBe('a')
  })

  it('sets a nested field at a drill path', () => {
    const doc = { _id: 1, addr: { city: 'NYC' } }
    const out = setFieldValue(doc, ['addr'], 'city', 'LA')
    expect(out.addr.city).toBe('LA')
    expect(doc.addr.city).toBe('NYC')
  })
})

describe('addFieldValue', () => {
  it('adds a new field', () => {
    const out = addFieldValue({ _id: 1 }, [], 'active', true)
    expect(out.active).toBe(true)
  })

  it('rejects duplicate and empty names', () => {
    expect(() => addFieldValue({ _id: 1, a: 1 }, [], 'a', 2)).toThrow(/already exists/)
    expect(() => addFieldValue({ _id: 1 }, [], '  ', 2)).toThrow(/field name/)
  })
})

describe('removeField', () => {
  it('removes a key from an object', () => {
    const out = removeField({ _id: 1, a: 1, b: 2 }, [], 'a')
    expect(out).toEqual({ _id: 1, b: 2 })
  })

  it('splices an element from an array container', () => {
    const doc = { _id: 1, tags: ['x', 'y', 'z'] }
    const out = removeField(doc, ['tags'], '1')
    expect(out.tags).toEqual(['x', 'z'])
  })
})

describe('renameField', () => {
  it('renames a key preserving order', () => {
    const out = renameField({ a: 1, b: 2, c: 3 }, [], 'b', 'bee')
    expect(Object.keys(out)).toEqual(['a', 'bee', 'c'])
    expect(out.bee).toBe(2)
  })

  it('rejects renaming onto an existing key', () => {
    expect(() => renameField({ a: 1, b: 2 }, [], 'a', 'b')).toThrow(/already exists/)
  })

  it('is a no-op when the name is unchanged', () => {
    expect(renameField({ a: 1 }, [], 'a', 'a')).toEqual({ a: 1 })
  })
})
