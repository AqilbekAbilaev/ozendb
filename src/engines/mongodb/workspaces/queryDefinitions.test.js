import { describe, it, expect, vi, beforeEach } from 'vitest'
import { queryDefinitions } from './queryDefinitions'
import { setCollectionQueryMode } from '../../../utils/queryMode'
import { isResourceRef } from '../../../utils/resourceRef'
import { duplicateWorkspace, restoreWorkspace, disposeWorkspace } from '../../../workspaces/lifecycle'
import { registerWorkspaceDefinitions } from '../../../workspaces/registerDefinitions'
import { closeShellSession } from '../api/shell'

registerWorkspaceDefinitions()

vi.mock('../api/shell', () => ({
  closeShellSession: vi.fn(() => Promise.resolve()),
  runShellCommand: vi.fn(),
  getShellHistory: vi.fn(),
  pushShellCommand: vi.fn(),
  clearShellHistory: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

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

const SOURCE = {
  id: 'src', kind: 'collection', type: 'mongodb.find', engine: 'mongodb',
  title: 'orders', color: '#f00',
  connectionId: 'c1', connectionName: 'Sales', dbName: 'shop', collectionName: 'orders',
  mode: 'find', filter: '{ "a": 1 }', projection: '{ "a": 1 }', sort: '{ "a": -1 }',
  skip: 2, limit: 25, pipeline: '[{ "$match": {} }]', vqb: { rows: [1] }, colOrder: { a: 0 },
  resultView: 'tree',
  results: [{ x: 1 }], hasRun: true, isRunning: true, runError: 'boom',
  selectedRow: 0, selectedRows: [0], elapsedMs: 12,
}

describe('lifecycle — duplicate', () => {
  it('duplicates using the query mode selected after creation', () => {
    const fromFind = { ...SOURCE }
    setCollectionQueryMode(fromFind, 'aggregate')
    const aggregate = duplicateWorkspace(fromFind)
    expect(fromFind.type).toBe('mongodb.aggregate')
    expect(aggregate.type).toBe('mongodb.aggregate')
    expect(aggregate.mode).toBe('aggregate')

    setCollectionQueryMode(aggregate, 'find')
    const find = duplicateWorkspace(aggregate)
    expect(aggregate.type).toBe('mongodb.find')
    expect(find.type).toBe('mongodb.find')
    expect(find.mode).toBe('find')
  })

  it('preserves query text exactly and resets runtime', () => {
    const dup = duplicateWorkspace(SOURCE)
    expect(dup.filter).toBe('{ "a": 1 }')
    expect(dup.projection).toBe('{ "a": 1 }')
    expect(dup.sort).toBe('{ "a": -1 }')
    expect(dup.skip).toBe(2)
    expect(dup.limit).toBe(25)
    expect(dup.mode).toBe('find')
    expect(dup.resultView).toBe('tree')
    expect(dup.results).toEqual([])
    expect(dup.hasRun).toBe(false)
    expect(dup.isRunning).toBe(false)
    expect(dup.runError).toBe(null)
    expect(dup.selectedRow).toBe(-1)
    expect(dup.selectedRows).toEqual([])
    expect(dup.elapsedMs).toBe(null)
  })

  it('receives the rerun marker so the bridge re-runs it once', () => {
    const dup = duplicateWorkspace(SOURCE)
    expect(dup._restored).toBe(true)
  })

  it('detaches nested VQB and column-order state', () => {
    const dup = duplicateWorkspace(SOURCE)
    expect(dup.vqb).not.toBe(SOURCE.vqb)
    expect(dup.colOrder).not.toBe(SOURCE.colOrder)
    dup.vqb.rows.push(2)
    dup.colOrder.a = 9
    expect(SOURCE.vqb.rows).toEqual([1])
    expect(SOURCE.colOrder.a).toBe(0)
  })

  it('aggregate and sql duplicates do not carry the rerun marker', () => {
    const agg = duplicateWorkspace({ ...SOURCE, type: 'mongodb.aggregate', mode: 'aggregate' })
    expect(agg._restored).toBeUndefined()
    const sql = duplicateWorkspace({
      ...SOURCE, type: 'mongodb.sql_to_mql', mode: 'sql',
      sql: 'SELECT * FROM orders', sqlError: 'nope', filter: 'x', projection: 'y',
    })
    expect(sql._restored).toBeUndefined()
    expect(sql.sql).toBe('SELECT * FROM orders')
    expect(sql.sqlError).toBe(null)
    expect(sql.filter).toBe('')
    expect(sql.projection).toBe('')
    expect(sql.pipeline).toBe('')
  })

  it('shell duplicate clones code but gets a fresh session and cleared output', () => {
    const shell = {
      id: 's', kind: 'shell', type: 'mongodb.shell', engine: 'mongodb',
      title: 'mongosh: shop', color: null,
      connectionId: 'c1', connectionName: 'Sales', dbName: 'shop',
      sessionId: 'old-session', code: 'db.orders.find()', scriptPath: '/tmp/x.js',
      history: ['a'], isRunning: true, results: [1], resultView: 'table', resultTab: 'Console',
      runError: 'boom', elapsedMs: 5, drillPath: ['a'], hasRun: true, selectedRow: 0,
      selectedRows: [0], logs: ['log'], scalar: 7, hasScalar: true,
    }
    const dup = duplicateWorkspace(shell, { ids: { session: () => 'fresh-session' } })
    expect(dup.sessionId).toBe('fresh-session')
    expect(dup.code).toBe('db.orders.find()')
    expect(dup.scriptPath).toBe('/tmp/x.js')
    expect(dup.history).toEqual([])
    expect(dup.logs).toEqual([])
    expect(dup.results).toEqual([])
    expect(dup.drillPath).toEqual([])
    expect(dup.isRunning).toBe(false)
    expect(dup.hasRun).toBe(false)
    expect(dup.hasScalar).toBe(false)
    expect(dup.scalar).toBeUndefined()
    expect(dup.runError).toBe(null)
  })
})

describe('lifecycle — restore', () => {
  const savedFind = {
    id: 'r1', kind: 'collection', title: 'orders', color: '#0f0',
    connectionId: 'c1', connectionName: 'Sales', dbName: 'shop', collectionName: 'orders',
    filter: '{ "a": 1 }', sort: '{ "a": -1 }', projection: '{ "a": 1 }',
    skip: 2, limit: 25, mode: 'find', pipeline: '', vqb: { rows: [1] }, colOrder: { a: 0 },
    resultView: 'json',
  }

  it('find restores editor state with fresh runtime and the one-shot marker', () => {
    const tab = restoreWorkspace(savedFind)
    expect(tab.filter).toBe('{ "a": 1 }')
    expect(tab.sort).toBe('{ "a": -1 }')
    expect(tab.skip).toBe(2)
    expect(tab.limit).toBe(25)
    expect(tab.resultView).toBe('json')
    expect(tab._restored).toBe(true)
    expect(tab.results).toEqual([])
    expect(tab.hasRun).toBe(false)
    expect(tab.elapsedMs).toBe(null)
    expect(tab.id).toBe('r1')
  })

  it('aggregate restores its pipeline and does not run', () => {
    const tab = restoreWorkspace({ ...savedFind, id: 'a', mode: 'aggregate', pipeline: '[{ "$match": {} }]' })
    expect(tab.mode).toBe('aggregate')
    expect(tab.pipeline).toBe('[{ "$match": {} }]')
    expect(tab._restored).toBeUndefined()
  })

  it('sql restores the SQL text but clears translated pieces and does not run', () => {
    const tab = restoreWorkspace({ ...savedFind, id: 's', mode: 'sql', sql: 'SELECT 1', readOnly: true })
    expect(tab.mode).toBe('sql')
    expect(tab.sql).toBe('SELECT 1')
    expect(tab.sqlError).toBe(null)
    expect(tab.filter).toBe('')
    expect(tab.projection).toBe('')
    expect(tab.pipeline).toBe('')
    expect(tab.readOnly).toBe(true)
    expect(tab._restored).toBeUndefined()
  })

  it('shell restore gets a fresh session id from the injected source', () => {
    const tab = restoreWorkspace({
      id: 'sh', kind: 'shell', title: 'mongosh: shop', color: null,
      connectionId: 'c1', connectionName: 'Sales', dbName: 'shop',
      sessionId: 'old-session', code: 'db.orders.find()', scriptPath: '/tmp/x.js',
    }, { ids: { session: () => 'fresh-session' } })
    expect(tab.sessionId).toBe('fresh-session')
    expect(tab.code).toBe('db.orders.find()')
    expect(tab.history).toEqual([])
    expect(tab.hasScalar).toBe(false)
  })
})

describe('lifecycle — shell disposal', () => {
  it('calls closeSession exactly once per disposed shell workspace', async () => {
    const shell = {
      id: 's', kind: 'shell', type: 'mongodb.shell', engine: 'mongodb',
      connectionId: 'c1', connectionName: 'Sales', dbName: 'shop',
      sessionId: 'sess-1', code: '', history: [], isRunning: false,
      results: [], resultView: 'table', resultTab: 'Console',
      runError: null, elapsedMs: null, drillPath: [], hasRun: false,
      selectedRow: -1, selectedRows: [], logs: [], scalar: undefined, hasScalar: false,
    }
    await disposeWorkspace(shell)
    expect(closeShellSession).toHaveBeenCalledTimes(1)
    expect(closeShellSession).toHaveBeenCalledWith('sess-1')
  })

  it('does not dispose non-shell workspaces', async () => {
    await disposeWorkspace(SOURCE)
    expect(closeShellSession).not.toHaveBeenCalled()
  })
})
