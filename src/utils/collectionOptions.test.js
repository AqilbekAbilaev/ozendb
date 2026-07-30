import { describe, it, expect } from 'vitest'
import { buildCollectionOptions, emptyCollectionOptions } from './collectionOptions'

// Pins the per-type field rules for Add Collection: which fields are required, which are
// optional (and become null rather than 0/''), and that a standard collection sends no
// options at all so the create request is unchanged from before the type picker existed.
const opts = (over = {}) => ({ ...emptyCollectionOptions(), ...over })

describe('standard', () => {
  it('sends no options', () => {
    const r = buildCollectionOptions('standard', opts())
    expect(r.ok).toBe(true)
    expect(r.options).toBeUndefined()
  })

  it('treats an unknown type as standard', () => {
    expect(buildCollectionOptions('nonsense', opts()).options).toBeUndefined()
  })
})

describe('capped', () => {
  it('requires a positive size', () => {
    for (const size of ['', '0', '-5', 'abc']) {
      const r = buildCollectionOptions('capped', opts({ size }))
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/maximum size/i)
    }
  })

  it('coerces size to a number', () => {
    const r = buildCollectionOptions('capped', opts({ size: '1048576' }))
    expect(r.ok).toBe(true)
    expect(r.options).toEqual({ capped: true, size: 1048576, max: null })
  })

  it('carries an optional max document count', () => {
    const r = buildCollectionOptions('capped', opts({ size: '1024', max: '1000' }))
    expect(r.options.max).toBe(1000)
  })

  it('nulls a non-positive max rather than sending 0', () => {
    expect(buildCollectionOptions('capped', opts({ size: '1024', max: '0' })).options.max).toBeNull()
    expect(buildCollectionOptions('capped', opts({ size: '1024', max: '' })).options.max).toBeNull()
  })
})

describe('timeseries', () => {
  it('requires a time field', () => {
    const r = buildCollectionOptions('timeseries', opts({ timeField: '   ' }))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/time field/i)
  })

  it('trims the time field', () => {
    const r = buildCollectionOptions('timeseries', opts({ timeField: '  ts  ' }))
    expect(r.ok).toBe(true)
    expect(r.options.timeField).toBe('ts')
  })

  it('nulls every omitted optional field', () => {
    const r = buildCollectionOptions('timeseries', opts({ timeField: 'ts' }))
    expect(r.options).toEqual({
      timeField: 'ts',
      metaField: null,
      granularity: null,
      expireAfterSeconds: null,
    })
  })

  it('carries the optional fields when given', () => {
    const r = buildCollectionOptions('timeseries', opts({
      timeField: 'ts', metaField: 'meta', granularity: 'hours', expireAfterSeconds: '86400',
    }))
    expect(r.options).toEqual({
      timeField: 'ts',
      metaField: 'meta',
      granularity: 'hours',
      expireAfterSeconds: 86400,
    })
  })
})

describe('clustered', () => {
  it('always sets the clustered flag', () => {
    const r = buildCollectionOptions('clustered', opts())
    expect(r.ok).toBe(true)
    expect(r.options).toEqual({ clustered: true, clusteredIndexName: null })
  })

  it('carries an optional index name', () => {
    const r = buildCollectionOptions('clustered', opts({ clusteredIndexName: ' events ' }))
    expect(r.options.clusteredIndexName).toBe('events')
  })
})
