import { describe, it, expect } from 'vitest'
import {
  isProtectedIndex, indexKeyLabel, indexSpecJson, isIndexHidden, indexType, indexProperties, requestedIndexHidden, indexSizesFrom, indexUsageFrom, indexSeedFromClipboard,
} from './indexSpec'

describe('isProtectedIndex', () => {
  it('protects only the _id_ index', () => {
    expect(isProtectedIndex('_id_')).toBe(true)
    expect(isProtectedIndex('email_1')).toBe(false)
    expect(isProtectedIndex('_id_2')).toBe(false)
    expect(isProtectedIndex('user_id_1')).toBe(false)
    expect(isProtectedIndex('')).toBe(false)
  })
})

describe('indexKeyLabel', () => {
  it('renders a single-field key', () => {
    expect(indexKeyLabel({ key: { email: 1 } })).toBe('email: 1')
  })

  it('renders a compound key in order with directions', () => {
    expect(indexKeyLabel({ key: { name: 1, age: -1 } })).toBe('name: 1, age: -1')
  })

  it('returns an empty string for a missing or malformed key', () => {
    expect(indexKeyLabel(null)).toBe('')
    expect(indexKeyLabel({})).toBe('')
    expect(indexKeyLabel({ key: 'nope' })).toBe('')
  })
})

describe('indexSpecJson', () => {
  it('serializes the full index definition as pretty JSON', () => {
    const spec = { v: 2, key: { email: 1 }, name: 'email_1', unique: true }
    const out = indexSpecJson(spec)
    expect(JSON.parse(out)).toEqual(spec)
    expect(out).toContain('\n') // pretty-printed
  })

  it('handles a nullish index', () => {
    expect(indexSpecJson(null)).toBe('{}')
  })
})

describe('isIndexHidden', () => {
  it('reflects the hidden flag', () => {
    expect(isIndexHidden({ name: 'a', hidden: true })).toBe(true)
    expect(isIndexHidden({ name: 'a', hidden: false })).toBe(false)
    expect(isIndexHidden({ name: 'a' })).toBe(false)
    expect(isIndexHidden(null)).toBe(false)
  })
})

describe('requestedIndexHidden', () => {
  it('honors an explicit menu state and toggles when none is supplied', () => {
    expect(requestedIndexHidden({ hidden: true }, true)).toBe(true)
    expect(requestedIndexHidden({ hidden: false }, false)).toBe(false)
    expect(requestedIndexHidden({ hidden: true })).toBe(false)
    expect(requestedIndexHidden({ hidden: false })).toBe(true)
  })
})

describe('indexType', () => {
  it('classifies a plain single or compound key as Regular', () => {
    expect(indexType({ key: { _id: 1 } })).toBe('Regular')
    expect(indexType({ key: { name: 1, age: -1 } })).toBe('Regular')
  })

  it('detects text, geospatial and hashed keys', () => {
    expect(indexType({ key: { bio: 'text' } })).toBe('Text')
    expect(indexType({ key: { loc: '2dsphere' } })).toBe('Geospatial')
    expect(indexType({ key: { loc: '2d' } })).toBe('Geospatial')
    expect(indexType({ key: { uid: 'hashed' } })).toBe('Hashed')
  })

  it('falls back to Regular for a missing or malformed key', () => {
    expect(indexType(null)).toBe('Regular')
    expect(indexType({})).toBe('Regular')
    expect(indexType({ key: 'nope' })).toBe('Regular')
  })
})

describe('indexProperties', () => {
  it('lists each property that applies', () => {
    expect(indexProperties({ name: 'a_1', unique: true })).toEqual(['Unique'])
    expect(indexProperties({ name: 'a_1', sparse: true })).toEqual(['Sparse'])
    expect(indexProperties({ name: 'a_1', partialFilterExpression: { x: 1 } })).toEqual(['Partial'])
    expect(indexProperties({ name: 'a_1', expireAfterSeconds: 3600 })).toEqual(['TTL'])
    expect(indexProperties({ name: 'a_1', hidden: true })).toEqual(['Hidden'])
  })

  it('treats the _id_ index as implicitly unique', () => {
    expect(indexProperties({ name: '_id_', key: { _id: 1 } })).toEqual(['Unique'])
  })

  it('returns an empty list when no property applies', () => {
    expect(indexProperties({ name: 'a_1' })).toEqual([])
    expect(indexProperties(null)).toEqual([])
  })
})

describe('indexSizesFrom', () => {
  it('maps each index to its size and keeps the total', () => {
    expect(indexSizesFrom({ indexes: [{ name: '_id_', size: 4096 }, { name: 'a_1', size: 8192 }], total_index_size: 12288 }))
      .toEqual({ sizes: { _id_: 4096, a_1: 8192 }, total: 12288 })
  })

  it('copes with stats that carry no index list or total', () => {
    expect(indexSizesFrom({})).toEqual({ sizes: {}, total: null })
  })
})

describe('indexUsageFrom', () => {
  it('reads each index\'s operation count, plain or as a $numberLong', () => {
    expect(indexUsageFrom([
      { name: '_id_', accesses: { ops: 3 } },
      { name: 'a_1', accesses: { ops: { $numberLong: '12' } } },
      { name: 'b_1', accesses: {} },
    ])).toEqual({ _id_: 3, a_1: '12' })
  })
})

describe('indexSeedFromClipboard', () => {
  it('turns a copied index spec into a create-form seed without its name', () => {
    expect(indexSeedFromClipboard('{ "key": { "a": 1 }, "name": "a_1", "unique": true }'))
      .toEqual({ ok: true, seed: { key: { a: 1 }, unique: true } })
  })

  it('says why text is not a spec', () => {
    expect(indexSeedFromClipboard('  ')).toEqual({ ok: false, message: 'Clipboard is empty' })
    expect(indexSeedFromClipboard('{ nope')).toEqual({ ok: false, message: 'Clipboard is not a valid index spec' })
    expect(indexSeedFromClipboard('{ "name": "x" }')).toEqual({ ok: false, message: 'Clipboard is not an index spec' })
  })
})
