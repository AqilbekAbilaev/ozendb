import { describe, it, expect } from 'vitest'
import { toolDefinitions } from './toolDefinitions'
import { isResourceRef } from '../../../utils/resourceRef'
import { duplicateWorkspace, restoreWorkspace } from '../../../workspaces/lifecycle'
import { registerWorkspaceDefinitions } from '../../../workspaces/registerDefinitions'

registerWorkspaceDefinitions()

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

describe('lifecycle — tools', () => {
  it('duplicates indexes and schema to the same target (pane reloads its own data)', () => {
    const idx = duplicateWorkspace({ id: 'i', type: 'mongodb.indexes', kind: 'indexes', title: 'Index Manager: orders', connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders' })
    expect(idx.type).toBe('mongodb.indexes')
    expect(idx.kind).toBe('indexes')
    expect(idx.target.segments.map(s => s.name)).toEqual(['shop', 'orders'])
    const sch = duplicateWorkspace({ id: 's', type: 'mongodb.schema', kind: 'schema', title: 'Schema: orders', connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders' })
    expect(sch.type).toBe('mongodb.schema')
    expect(sch.kind).toBe('schema')
  })

  it('schema and search duplicates can never become collection workspaces', () => {
    const sch = duplicateWorkspace({ id: 's', type: 'mongodb.schema', kind: 'schema', title: 'Schema: orders', connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders' })
    expect(sch.kind).toBe('schema')
    expect(sch.mode).toBeUndefined()
    const search = duplicateWorkspace({ id: 'q', type: 'mongodb.search', kind: 'search', title: 'Search: shop', connId: 'c1', connName: 'Sales', dbName: 'shop' })
    expect(search.kind).toBe('search')
    expect(search.target.segments.map(s => s.name)).toEqual(['shop'])
  })

  it('csv import duplicate keeps source and options but resets the mapping', () => {
    const src = {
      id: 'i', type: 'mongodb.import', kind: 'import', title: 'Import: orders',
      connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders',
      format: 'csv', subTab: 'target', sourceType: 'clipboard', filePath: '/tmp/a.csv',
      csv: { delimiter: ';', other: '', qualifier: "'", skipLines: 2, hasHeader: false },
      targetDb: 'shop', targetColl: 'orders', mode: 'upsert',
      fields: [{ source: 'a', target: 'b' }],
    }
    const dup = duplicateWorkspace(src)
    expect(dup.format).toBe('csv')
    expect(dup.sourceType).toBe('clipboard')
    expect(dup.filePath).toBe('/tmp/a.csv')
    expect(dup.csv).toEqual({ delimiter: ';', other: '', qualifier: "'", skipLines: 2, hasHeader: false })
    expect(dup.csv).not.toBe(src.csv)
    expect(dup.targetDb).toBe('shop')
    expect(dup.mode).toBe('upsert')
    expect(dup.fields).toEqual([])
  })

  it('json import duplicate detaches sources and resets preview state', () => {
    const source = { path: '/a.json', name: 'a', targetDb: 'shop', targetColl: 'orders', mode: 'insert' }
    const dup = duplicateWorkspace({
      id: 'i', type: 'mongodb.import', kind: 'import', title: 'Import: orders',
      connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders',
      format: 'json', validate: true,
      sources: [source], selectedSource: 0, previewOpen: true,
    })
    expect(dup.validate).toBe(true)
    expect(dup.sources).toEqual([source])
    expect(dup.sources).not.toBeUndefined()
    expect(dup.sources[0]).not.toBe(source)
    expect(dup.selectedSource).toBe(-1)
    expect(dup.previewOpen).toBe(false)
  })

  it('export duplicate persists mapping and filter but clears the result banner', () => {
    const dup = duplicateWorkspace({
      id: 'e', type: 'mongodb.export', kind: 'export', title: 'Export: orders',
      connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders',
      step: 2, format: 'csv', incremental: true, source: 'query',
      sourceCount: 5, filter: '{ "a": 1 }',
      fields: [{ source: 'a', target: 'b', kind: 'string', include: true }],
      result: { count: 3, path: '/tmp/x.csv' },
    })
    expect(dup.filter).toBe('{ "a": 1 }')
    expect(dup.source).toBe('query')
    expect(dup.sourceCount).toBe(5)
    expect(dup.fields).toEqual([{ source: 'a', target: 'b', kind: 'string', include: true }])
    expect(dup.result).toBe(null)
  })

  it('current operations duplicate clones settings over fresh defaults', () => {
    const dup = duplicateWorkspace({
      id: 'o', type: 'mongodb.current_operations', kind: 'currentOps', title: 'Current Operations: Sales',
      connId: 'c1', connName: 'Sales',
      frequency: 500, retention: 30_000, ownOnly: true, showSys: true,
      slowOnly: true, slowSecs: 7, dbName: 'shop', collName: 'orders', view: 'text',
      ops: [{ id: 1 }], results: [{ x: 1 }], selectedRows: [0],
    })
    expect(dup.frequency).toBe(500)
    expect(dup.retention).toBe(30_000)
    expect(dup.ownOnly).toBe(true)
    expect(dup.showSys).toBe(true)
    expect(dup.slowOnly).toBe(true)
    expect(dup.slowSecs).toBe(7)
    expect(dup.dbName).toBe('shop')
    expect(dup.view).toBe('text')
    expect(dup.ops).toEqual([])
    expect(dup.results).toEqual([])
    expect(dup.selectedRows).toEqual([])
    expect(dup.colOrder).toEqual({})
  })
})

describe('lifecycle — tool restore', () => {
  it('csv import restores options with safe defaults when they are missing', () => {
    const tab = restoreWorkspace({
      id: 'i', kind: 'import', title: 'Import: orders', color: null,
      connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders',
      format: 'csv',
    })
    expect(tab.format).toBe('csv')
    expect(tab.sourceType).toBe('file')
    expect(tab.filePath).toBe('')
    expect(tab.csv).toEqual({ delimiter: ',', other: '', qualifier: '"', skipLines: 0, hasHeader: true })
    expect(tab.mode).toBe('insert')
    expect(tab.fields).toEqual([])
  })

  it('json import restores sources and selects the first one', () => {
    const tab = restoreWorkspace({
      id: 'i', kind: 'import', title: 'Import: orders', color: null,
      connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders',
      format: 'json', validate: true,
      sources: [{ path: '/a.json', name: 'a', targetDb: 'shop', targetColl: 'orders', mode: 'insert' }],
    })
    expect(tab.validate).toBe(true)
    expect(tab.sources).toHaveLength(1)
    expect(tab.selectedSource).toBe(0)
    expect(tab.previewOpen).toBe(false)
  })

  it('export restore keeps the mapping but clears the run result', () => {
    const tab = restoreWorkspace({
      id: 'e', kind: 'export', title: 'Export: orders', color: null,
      connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders',
      step: 1, format: 'csv', incremental: true, source: 'collection',
      sourceCount: null, filter: '{ "a": 1 }',
      fields: [{ source: 'a', target: 'b', kind: 'string', include: true }],
    })
    expect(tab.filter).toBe('{ "a": 1 }')
    expect(tab.fields).toHaveLength(1)
    expect(tab.result).toBe(null)
  })

  it('current operations restore settings over fresh defaults', () => {
    const tab = restoreWorkspace({
      id: 'o', kind: 'currentOps', title: 'Current Operations: Sales', color: null,
      connId: 'c1', connName: 'Sales',
      frequency: 500, retention: 30_000, ownOnly: true, showSys: true,
      slowOnly: true, slowSecs: 7, dbName: 'shop', collName: 'orders', view: 'text',
    })
    expect(tab.frequency).toBe(500)
    expect(tab.retention).toBe(30_000)
    expect(tab.ownOnly).toBe(true)
    expect(tab.showSys).toBe(true)
    expect(tab.slowOnly).toBe(true)
    expect(tab.slowSecs).toBe(7)
    expect(tab.dbName).toBe('shop')
    expect(tab.view).toBe('text')
    expect(tab.ops).toEqual([])
    expect(tab.results).toEqual([])
  })

  it('indexes restore keeps identity only', () => {
    const tab = restoreWorkspace({
      id: 'x', kind: 'indexes', title: 'Index Manager: orders', color: null,
      connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders',
    })
    expect(tab.kind).toBe('indexes')
    expect(tab.connId).toBe('c1')
    expect(tab.collName).toBe('orders')
    expect(tab.target.segments.map(s => s.name)).toEqual(['shop', 'orders'])
  })

  it('schema and search remain non-persisted', () => {
    expect(restoreWorkspace({ id: 's', kind: 'schema' })).toBe(null)
    expect(restoreWorkspace({ id: 'q', kind: 'search' })).toBe(null)
  })
})