import { describe, it, expect } from 'vitest'
import { toolDefinitions } from './toolDefinitions'
import { isResourceRef } from '../../../utils/resourceRef'

const defFor = (type) => toolDefinitions.find(d => d.type === type)
const ctx = (target, options = {}) => ({
  target,
  defaults: {},
  options,
  ids: { workspace: () => 'w-1', session: () => 'sess-1' },
})

const COLLECTION = { connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders' }
const DATABASE = { connId: 'c1', connName: 'Sales', dbName: 'shop' }
const CONNECTION = { connId: 'c1', connName: 'Sales' }

function expectCollectionDepth(created) {
  expect(isResourceRef(created.target)).toBe(true)
  expect(created.target.connectionId).toBe('c1')
  expect(created.target.segments.map(s => s.name)).toEqual(['shop', 'orders'])
}

describe('mongodb.indexes', () => {
  const created = defFor('mongodb.indexes').create(ctx(COLLECTION))

  it('is collection-scoped with the open/focus identity fields', () => {
    expect(created.title).toBe('Index Manager: orders')
    expect(created.fields).toEqual({ kind: 'indexes', ...COLLECTION })
    expectCollectionDepth(created)
  })
})

describe('mongodb.schema', () => {
  const created = defFor('mongodb.schema').create(ctx(COLLECTION))

  it('is collection-scoped like indexes', () => {
    expect(created.title).toBe('Schema: orders')
    expect(created.fields.kind).toBe('schema')
    expect(created.fields.connId).toBe('c1')
    expect(created.fields.collName).toBe('orders')
    expectCollectionDepth(created)
  })
})

describe('mongodb.search', () => {
  const created = defFor('mongodb.search').create(ctx(DATABASE))

  it('is database-scoped (searches every collection in the db)', () => {
    expect(created.title).toBe('Search: shop')
    expect(created.fields).toEqual({ kind: 'search', ...DATABASE })
    expect(isResourceRef(created.target)).toBe(true)
    expect(created.target.segments.map(s => s.name)).toEqual(['shop'])
  })
})

describe('mongodb.import', () => {
  it('builds the CSV variant with its single-source shape', () => {
    const created = defFor('mongodb.import').create(ctx(COLLECTION, { format: 'csv' }))
    expect(created.title).toBe('Import: orders')
    expect(created.fields.format).toBe('csv')
    expect(created.fields.subTab).toBe('source')
    expect(created.fields.sourceType).toBe('file')
    expect(created.fields.filePath).toBe('')
    expect(created.fields.csv).toEqual({ delimiter: ',', other: '', qualifier: '"', skipLines: 0, hasHeader: true })
    expect(created.fields.targetDb).toBe('shop')
    expect(created.fields.targetColl).toBe('orders')
    expect(created.fields.mode).toBe('insert')
    expect(created.fields.fields).toEqual([])
    expectCollectionDepth(created)
  })

  it('builds the JSON variant with its multi-source shape', () => {
    const created = defFor('mongodb.import').create(ctx(COLLECTION, { format: 'json' }))
    expect(created.fields.format).toBe('json')
    expect(created.fields.validate).toBe(false)
    expect(created.fields.sources).toEqual([])
    expect(created.fields.selectedSource).toBe(-1)
    expect(created.fields.previewOpen).toBe(false)
    expect(created.fields.csv).toBeUndefined()
  })

  it('defaults to the JSON variant when no format is given', () => {
    const created = defFor('mongodb.import').create(ctx(COLLECTION))
    expect(created.fields.format).toBe('json')
    expect(created.fields.sources).toEqual([])
  })

  it('keeps csv options private to each creation', () => {
    const a = defFor('mongodb.import').create(ctx(COLLECTION, { format: 'csv' }))
    const b = defFor('mongodb.import').create(ctx(COLLECTION, { format: 'csv' }))
    expect(a.fields.csv).not.toBe(b.fields.csv)
  })
})

describe('mongodb.export', () => {
  it('starts at the collection source with no frozen filter', () => {
    const created = defFor('mongodb.export').create(ctx(COLLECTION))
    expect(created.title).toBe('Export: orders')
    expect(created.fields.kind).toBe('export')
    expect(created.fields.source).toBe('collection')
    expect(created.fields.filter).toBe('{}')
    expect(created.fields.sourceCount).toBe(null)
    expect(created.fields.step).toBe(0)
    expect(created.fields.format).toBe('json')
    expect(created.fields.incremental).toBe(false)
    expect(created.fields.fields).toEqual([])
    expect(created.fields.result).toBe(null)
    expectCollectionDepth(created)
  })

  it('freezes the originating query as the filter and marks the title', () => {
    const created = defFor('mongodb.export').create(ctx(
      { ...COLLECTION, query: '{ "status": "open" }' },
      { source: 'query' },
    ))
    expect(created.fields.source).toBe('query')
    expect(created.fields.filter).toBe('{ "status": "open" }')
    expect(created.fields.sourceCount).toBe(null)
    expect(created.title).toBe('Export: orders (query)')
  })

  it('freezes the selected _ids and counts them', () => {
    const created = defFor('mongodb.export').create(ctx(
      { ...COLLECTION, selectedIds: ['a', 'b', 'c'] },
      { source: 'selected' },
    ))
    expect(created.fields.source).toBe('selected')
    expect(created.fields.filter).toBe('{"_id":{"$in":["a","b","c"]}}')
    expect(created.fields.sourceCount).toBe(3)
    expect(created.title).toBe('Export: orders (3 selected)')
  })
})

describe('mongodb.current_operations', () => {
  const created = defFor('mongodb.current_operations').create(ctx(CONNECTION))

  it('is connection-scoped with the toolbar settings on the tab', () => {
    expect(created.title).toBe('Current Operations: Sales')
    expect(created.fields.kind).toBe('currentOps')
    expect(created.fields.connId).toBe('c1')
    expect(created.fields.connName).toBe('Sales')
    expect(created.fields.frequency).toBe(2000)
    expect(created.fields.retention).toBe(10_000)
    expect(created.fields.ownOnly).toBe(false)
    expect(created.fields.showSys).toBe(false)
    expect(created.fields.slowOnly).toBe(false)
    expect(created.fields.slowSecs).toBe(3)
    expect(created.fields.view).toBe('table')
    expect(isResourceRef(created.target)).toBe(true)
    expect(created.target.segments).toEqual([])
  })

  it('allocates fresh runtime arrays and maps per creation', () => {
    const a = defFor('mongodb.current_operations').create(ctx(CONNECTION))
    const b = defFor('mongodb.current_operations').create(ctx(CONNECTION))
    expect(a.fields.ops).not.toBe(b.fields.ops)
    expect(a.fields.results).not.toBe(b.fields.results)
    expect(a.fields.selectedRows).not.toBe(b.fields.selectedRows)
    expect(a.fields.colOrder).not.toBe(b.fields.colOrder)
  })
})