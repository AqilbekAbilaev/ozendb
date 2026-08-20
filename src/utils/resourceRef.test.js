import { describe, it, expect } from 'vitest'
import {
  createResourceRef, appendResource, isResourceRef,
  resourceKind, resourceName, sameResource, isResourceAncestor,
} from './resourceRef'

const db = (name) => ({ kind: 'database', name: name })

describe('createResourceRef', () => {
  it('constructs connection, database and collection references', () => {
    expect(createResourceRef('c1')).toEqual({ connectionId: 'c1', segments: [] })
    expect(createResourceRef('c1', [db('app')])).toEqual({
      connectionId: 'c1', segments: [db('app')],
    })
    expect(createResourceRef('c1', [db('app'), { kind: 'collection', name: 'users' }])).toEqual({
      connectionId: 'c1',
      segments: [db('app'), { kind: 'collection', name: 'users' }],
    })
  })

  it('supports deeper future hierarchies such as database/schema/table', () => {
    const ref = createResourceRef('pg1', [
      db('app'),
      { kind: 'schema', name: 'public' },
      { kind: 'table', name: 'users' },
    ])
    expect(resourceKind(ref)).toBe('table')
    expect(resourceName(ref)).toBe('users')
  })

  it('preserves names containing slashes, dots, spaces and unicode', () => {
    const ref = createResourceRef('c1', [db('my app.2'), { kind: 'collection', name: 'orders/2024' }])
    expect(ref.segments[1].name).toBe('orders/2024')
  })

  it('copies the segments array so callers cannot mutate the reference', () => {
    const segments = [db('app')]
    const ref = createResourceRef('c1', segments)
    segments.push({ kind: 'collection', name: 'users' })
    expect(ref.segments).toHaveLength(1)
  })

  it('rejects invalid connection ids', () => {
    expect(() => createResourceRef('')).toThrow()
    expect(() => createResourceRef(undefined)).toThrow()
    expect(() => createResourceRef(null)).toThrow()
    expect(() => createResourceRef(42)).toThrow()
  })

  it('rejects invalid segments', () => {
    expect(() => createResourceRef('c1', 'nope')).toThrow()
    expect(() => createResourceRef('c1', [null])).toThrow()
    expect(() => createResourceRef('c1', [{ kind: 'database' }])).toThrow()
    expect(() => createResourceRef('c1', [{ kind: '', name: 'app' }])).toThrow()
    expect(() => createResourceRef('c1', [{ kind: 'database', name: '' }])).toThrow()
  })
})

describe('appendResource', () => {
  it('returns a new deeper reference without mutating the input', () => {
    const base = createResourceRef('c1', [db('app')])
    const deeper = appendResource(base, 'collection', 'users')
    expect(deeper.segments).toHaveLength(2)
    expect(base.segments).toHaveLength(1)
    expect(deeper).toEqual(createResourceRef('c1', [db('app'), { kind: 'collection', name: 'users' }]))
  })

  it('rejects invalid arguments', () => {
    expect(() => appendResource(null, 'database', 'app')).toThrow()
    expect(() => appendResource(createResourceRef('c1'), '', 'app')).toThrow()
    expect(() => appendResource(createResourceRef('c1'), 'database', '')).toThrow()
  })
})

describe('isResourceRef', () => {
  it('accepts only well-formed references', () => {
    expect(isResourceRef(createResourceRef('c1'))).toBe(true)
    expect(isResourceRef(null)).toBe(false)
    expect(isResourceRef({ connectionId: 'c1' })).toBe(false)
    expect(isResourceRef({ connectionId: 'c1', segments: [{ kind: '' }] })).toBe(false)
    expect(isResourceRef({ connectionId: '', segments: [] })).toBe(false)
    expect(isResourceRef({ connectionId: 'c1', segments: 'x' })).toBe(false)
  })

  it('tolerates presentation metadata as long as identity fields are sound', () => {
    expect(isResourceRef({ connectionId: 'c1', connectionName: 'Local', segments: [] })).toBe(true)
  })
})

describe('resourceKind and resourceName', () => {
  it('derives kind and name from the final segment', () => {
    expect(resourceKind(createResourceRef('c1'))).toBe('connection')
    expect(resourceName(createResourceRef('c1'))).toBe(null)
    expect(resourceKind(createResourceRef('c1', [db('app')]))).toBe('database')
    expect(resourceName(createResourceRef('c1', [db('app')]))).toBe('app')
  })

  it('returns null for malformed input', () => {
    expect(resourceKind(null)).toBe(null)
    expect(resourceName('c1')).toBe(null)
  })
})

describe('sameResource', () => {
  it('compares structurally equal and unequal references', () => {
    const a = createResourceRef('c1', [db('app'), { kind: 'collection', name: 'users' }])
    expect(sameResource(a, createResourceRef('c1', [db('app'), { kind: 'collection', name: 'users' }]))).toBe(true)
    expect(sameResource(a, createResourceRef('c2', [db('app'), { kind: 'collection', name: 'users' }]))).toBe(false)
    expect(sameResource(a, createResourceRef('c1', [db('app')]))).toBe(false)
    expect(sameResource(a, createResourceRef('c1', [db('other'), { kind: 'collection', name: 'users' }]))).toBe(false)
  })

  it('ignores presentation metadata and extra fields', () => {
    const a = createResourceRef('c1', [db('app')])
    const b = { connectionId: 'c1', segments: [db('app')], connectionName: 'Local' }
    expect(sameResource(a, b)).toBe(true)
  })

  it('returns false for malformed input', () => {
    expect(sameResource(null, createResourceRef('c1'))).toBe(false)
    expect(sameResource(createResourceRef('c1'), undefined)).toBe(false)
  })
})

describe('isResourceAncestor', () => {
  it('detects parent and descendant relationships', () => {
    const conn = createResourceRef('c1')
    const database = createResourceRef('c1', [db('app')])
    const coll = createResourceRef('c1', [db('app'), { kind: 'collection', name: 'users' }])
    expect(isResourceAncestor(conn, database)).toBe(true)
    expect(isResourceAncestor(conn, coll)).toBe(true)
    expect(isResourceAncestor(database, coll)).toBe(true)
    expect(isResourceAncestor(coll, database)).toBe(false)
    expect(isResourceAncestor(database, conn)).toBe(false)
  })

  it('does not count a reference as its own ancestor', () => {
    const coll = createResourceRef('c1', [db('app'), { kind: 'collection', name: 'users' }])
    expect(isResourceAncestor(coll, coll)).toBe(false)
    expect(isResourceAncestor(createResourceRef('c1'), createResourceRef('c1'))).toBe(false)
  })

  it('never crosses connections or diverging paths', () => {
    const a = createResourceRef('c1', [db('app')])
    expect(isResourceAncestor(a, createResourceRef('c2', [db('app'), { kind: 'collection', name: 'users' }]))).toBe(false)
    expect(isResourceAncestor(
      createResourceRef('c1', [db('other')]),
      createResourceRef('c1', [db('app'), { kind: 'collection', name: 'users' }]),
    )).toBe(false)
  })

  it('returns false for malformed input', () => {
    expect(isResourceAncestor(null, createResourceRef('c1'))).toBe(false)
    expect(isResourceAncestor(createResourceRef('c1'), 'x')).toBe(false)
  })
})