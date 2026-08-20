import { describe, it, expect } from 'vitest'
import { queryDefinitions } from './queryDefinitions'
import { isResourceRef } from '../../../utils/resourceRef'

const defFor = (type) => queryDefinitions.find(d => d.type === type)
const ctx = (target, defaults = {}, ids = {}) => ({
  target,
  defaults,
  options: {},
  ids: { workspace: () => 'w-1', session: () => crypto.randomUUID(), ...ids },
})

const COLLECTION = { connectionId: 'c1', connectionName: 'Sales', dbName: 'shop', collectionName: 'orders' }
const DATABASE = { connectionId: 'c1', connectionName: 'Sales', dbName: 'shop' }

describe('mongodb.find', () => {
  const created = defFor('mongodb.find').create(ctx(COLLECTION, { queryLimit: 25, resultView: 'grid' }))

  it('owns the compatibility kind and mode', () => {
    expect(created.fields.kind).toBe('collection')
    expect(created.fields.mode).toBe('find')
  })

  it('applies the query-limit and result-view defaults', () => {
    expect(created.fields.limit).toBe(25)
    expect(created.fields.resultView).toBe('grid')
  })

  it('falls back to the app defaults when none are supplied', () => {
    const bare = defFor('mongodb.find').create(ctx(COLLECTION))
    expect(bare.fields.limit).toBe(50)
    expect(bare.fields.resultView).toBe('table')
  })

  it('starts with empty editors and fresh result containers', () => {
    expect(created.fields.filter).toBe('')
    expect(created.fields.projection).toBe('')
    expect(created.fields.sort).toBe('')
    expect(created.fields.skip).toBe(0)
    expect(created.fields.pipeline).toBe('')
    expect(created.fields.vqb).toBe(null)
    expect(created.fields.results).toEqual([])
    expect(created.fields.hasRun).toBe(false)
    expect(created.fields.isRunning).toBe(false)
    expect(created.fields.runError).toBe(null)
    expect(created.fields.selectedRow).toBe(-1)
    expect(created.fields.selectedRows).toEqual([])
    expect(created.fields.elapsedMs).toBe(null)
  })

  it('carries the flat identity fields and a canonical collection target', () => {
    expect(created.fields.connectionId).toBe('c1')
    expect(created.fields.connectionName).toBe('Sales')
    expect(created.fields.dbName).toBe('shop')
    expect(created.fields.collectionName).toBe('orders')
    expect(created.title).toBe('orders')
    const ref = created.target
    expect(isResourceRef(ref)).toBe(true)
    expect(ref.connectionId).toBe('c1')
    expect(ref.segments.map(s => s.name)).toEqual(['shop', 'orders'])
  })
})

describe('mongodb.aggregate', () => {
  const created = defFor('mongodb.aggregate').create(ctx(COLLECTION))

  it('is a collection workspace in aggregate mode with an empty pipeline', () => {
    expect(created.fields.kind).toBe('collection')
    expect(created.fields.mode).toBe('aggregate')
    expect(created.fields.pipeline).toBe('')
    expect(created.title).toBe('orders')
  })
})

describe('mongodb.sql_to_mql', () => {
  const created = defFor('mongodb.sql_to_mql').create(ctx(COLLECTION))

  it('titles from the collection and seeds the SQL editor', () => {
    expect(created.title).toBe('SQL: orders')
    expect(created.fields.sql).toBe('SELECT *\nFROM orders')
    expect(created.fields.sqlError).toBe(null)
    expect(created.fields.mode).toBe('sql')
  })

  it('shares the collection result spine', () => {
    expect(created.fields.kind).toBe('collection')
    expect(created.fields.results).toEqual([])
    expect(created.fields.resultView).toBe('table')
  })
})

describe('mongodb.shell', () => {
  const created = defFor('mongodb.shell').create(ctx(DATABASE, {}, { session: () => 'sess-7' }))

  it('titles from the database and scopes to database depth', () => {
    expect(created.title).toBe('mongosh: shop')
    expect(created.fields.kind).toBe('shell')
    expect(created.fields.connectionId).toBe('c1')
    expect(created.fields.dbName).toBe('shop')
    expect(created.fields.connectionName).toBe('Sales')
    const ref = created.target
    expect(ref.segments.map(s => s.name)).toEqual(['shop'])
  })

  it('takes its session id from the injected source', () => {
    expect(created.fields.sessionId).toBe('sess-7')
  })

  it('starts with fresh editor, history, and result containers', () => {
    expect(created.fields.code).toBe('')
    expect(created.fields.history).toEqual([])
    expect(created.fields.isRunning).toBe(false)
    expect(created.fields.results).toEqual([])
    expect(created.fields.resultView).toBe('table')
    expect(created.fields.resultTab).toBe('Console')
    expect(created.fields.runError).toBe(null)
    expect(created.fields.elapsedMs).toBe(null)
    expect(created.fields.drillPath).toEqual([])
    expect(created.fields.hasRun).toBe(false)
    expect(created.fields.selectedRow).toBe(-1)
    expect(created.fields.selectedRows).toEqual([])
    expect(created.fields.logs).toEqual([])
    expect(created.fields.hasScalar).toBe(false)
  })
})

describe('query definitions — no shared mutable state', () => {
  it('gives every shell tab a fresh session id', () => {
    const a = defFor('mongodb.shell').create(ctx(DATABASE))
    const b = defFor('mongodb.shell').create(ctx(DATABASE))
    expect(a.fields.sessionId).not.toBe(b.fields.sessionId)
  })

  it('gives every creation fresh result, selection, history, and logs arrays', () => {
    const a = defFor('mongodb.find').create(ctx(COLLECTION))
    const b = defFor('mongodb.find').create(ctx(COLLECTION))
    expect(a.fields.results).not.toBe(b.fields.results)
    expect(a.fields.selectedRows).not.toBe(b.fields.selectedRows)
    const s1 = defFor('mongodb.shell').create(ctx(DATABASE))
    const s2 = defFor('mongodb.shell').create(ctx(DATABASE))
    expect(s1.fields.history).not.toBe(s2.fields.history)
    expect(s1.fields.logs).not.toBe(s2.fields.logs)
    expect(s1.fields.drillPath).not.toBe(s2.fields.drillPath)
  })
})