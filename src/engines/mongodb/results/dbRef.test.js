import { describe, it, expect } from 'vitest'
import { dbRefOf, idFilterString } from './dbRef'

describe('dbRefOf', () => {
  it('recognizes a full DBRef', () => {
    const ref = dbRefOf({ $ref: 'orders', $id: { $oid: 'abc' }, $db: 'shop' })
    expect(ref).toEqual({ ref: 'orders', id: { $oid: 'abc' }, db: 'shop' })
  })

  it('recognizes a DBRef without $db', () => {
    const ref = dbRefOf({ $ref: 'orders', $id: { $oid: 'abc' } })
    expect(ref).toEqual({ ref: 'orders', id: { $oid: 'abc' }, db: null })
  })

  it('rejects a plain object', () => {
    expect(dbRefOf({ name: 'x' })).toBeNull()
  })

  it('rejects a bare ObjectId (not a reference on its own)', () => {
    expect(dbRefOf({ $oid: 'abc' })).toBeNull()
  })

  it('rejects primitives, null and arrays', () => {
    expect(dbRefOf('x')).toBeNull()
    expect(dbRefOf(5)).toBeNull()
    expect(dbRefOf(null)).toBeNull()
    expect(dbRefOf([{ $ref: 'x', $id: 1 }])).toBeNull()
  })

  it('requires $id to be present even if $ref is a string', () => {
    expect(dbRefOf({ $ref: 'orders' })).toBeNull()
  })
})

describe('idFilterString', () => {
  it('builds an ObjectId filter for an $oid id', () => {
    expect(idFilterString({ $oid: 'deadbeef' })).toBe('{ "_id": ObjectId("deadbeef") }')
  })

  it('quotes a string id', () => {
    expect(idFilterString('user-42')).toBe('{ "_id": "user-42" }')
  })

  it('emits a numeric id as a literal', () => {
    expect(idFilterString(7)).toBe('{ "_id": 7 }')
  })

  it('falls back to JSON for other id types', () => {
    expect(idFilterString({ $date: '2026-01-01T00:00:00Z' })).toBe('{ "_id": {"$date":"2026-01-01T00:00:00Z"} }')
  })
})
