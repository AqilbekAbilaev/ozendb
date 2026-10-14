import { describe, it, expect, vi } from 'vitest'
import { duplicateWorkspace, restoreWorkspace, disposeWorkspace, canRefreshWorkspace, deepClone, affectedByResource, retargetResource } from './lifecycle'
import { registerWorkspaceDefinition } from './registry'
import { registerWorkspaceDefinitions } from './registerDefinitions'
import { createResourceRef } from '../utils/resourceRef'

registerWorkspaceDefinitions()

const FIND = {
  id: 'f1', type: 'mongodb.find', engine: 'mongodb', title: 'orders',
  color: '#f00', target: createResourceRef('c1', [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }]),
  connectionId: 'c1', connectionName: 'Sales', dbName: 'shop', collectionName: 'orders',
  filter: '{ "a": 1 }', projection: '{}', sort: '{}', skip: 2, limit: 25,
  mode: 'find', pipeline: '', vqb: { rows: [1, 2] }, colOrder: { a: 0 },
  results: [{ x: 1 }], hasRun: true, isRunning: false, runError: null,
  selectedRow: 0, selectedRows: [0], elapsedMs: 12,
}

describe('duplicateWorkspace', () => {
  it('receives a fresh workspace id from the injected source', () => {
    const dup = duplicateWorkspace(FIND, { ids: { workspace: () => 'w-7' } })
    expect(dup.id).toBe('w-7')
    expect(dup.id).not.toBe(FIND.id)
  })

  it('copies the common metadata centrally', () => {
    const dup = duplicateWorkspace(FIND)
    expect(dup.type).toBe('mongodb.find')
    expect(dup.engine).toBe('mongodb')
    expect(dup.title).toBe('orders')
    expect(dup.color).toBe('#f00')
  })

  it('deeply detaches durable fields from the source', () => {
    const dup = duplicateWorkspace(FIND)
    expect(dup.state.query.colOrder).not.toBe(FIND.colOrder)
    expect(dup.state.query.vqb).not.toBe(FIND.vqb)
    dup.state.query.colOrder.a = 99
    dup.state.query.vqb.rows.push(3)
    expect(FIND.colOrder.a).toBe(0)
    expect(FIND.vqb.rows).toEqual([1, 2])
  })

  it('detaches the canonical target', () => {
    const dup = duplicateWorkspace(FIND)
    expect(dup.target).not.toBe(FIND.target)
    expect(dup.target.segments).not.toBe(FIND.target.segments)
    expect(dup.target.connectionId).toBe('c1')
  })

  it('resets runtime state and preserves editor text', () => {
    const dup = duplicateWorkspace(FIND)
    expect(dup.state.query.filter).toBe('{ "a": 1 }')
    expect(dup.runtime.results).toEqual([])
    expect(dup.runtime.hasRun).toBe(false)
    expect(dup.runtime.elapsedMs).toBe(null)
    expect(dup.runtime.selectedRow).toBe(-1)
    expect(dup.runtime.selectedRows).toEqual([])
  })

  it('returns null for an unsupported duplicate', () => {
    const quickstart = { id: 'q', type: 'app.quickstart', title: 'Quickstart' }
    expect(duplicateWorkspace(quickstart)).toBe(null)
  })

  it('fails clearly for an unknown type', () => {
    expect(() => duplicateWorkspace({ id: 'x', type: 'no.such.type' })).toThrow(/Unknown workspace type/)
  })
})

describe('restoreWorkspace', () => {
  const saved = {
    id: 'r1', type: 'mongodb.find', title: 'orders', color: '#0f0',
    target: createResourceRef('c1', [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }]),
    connectionId: 'c1', connectionName: 'Sales', dbName: 'shop', collectionName: 'orders',
    filter: '{ "a": 1 }', sort: '{}', projection: '{}', skip: 0, limit: 25,
    mode: 'find', pipeline: '', vqb: { rows: [1] }, colOrder: { a: 0 },
  }

  it('reconstructs through the saved type and keeps the saved id', () => {
    const tab = restoreWorkspace(saved)
    expect(tab.id).toBe('r1')
    expect(tab.type).toBe('mongodb.find')
    expect(tab.engine).toBe('mongodb')
    expect(tab.color).toBe('#0f0')
    expect(tab.title).toBe('orders')
  })

  it('restores fresh runtime state and the one-shot initial-run marker', () => {
    const tab = restoreWorkspace(saved)
    expect(tab.state.query.filter).toBe('{ "a": 1 }')
    expect(tab.needsInitialRun).toBe(true)
    expect(tab.runtime.results).toEqual([])
    expect(tab.runtime.hasRun).toBe(false)
    expect(tab.runtime.selectedRow).toBe(-1)
  })

  it('restores SQL and aggregate records as their own types', () => {
    const aggregate = { ...saved, id: 'a', type: 'mongodb.aggregate', mode: 'aggregate', pipeline: '[{ "$match": {} }]' }
    expect(restoreWorkspace(aggregate).type).toBe('mongodb.aggregate')
    expect(restoreWorkspace({ ...saved, id: 's', type: 'mongodb.sql_to_mql', mode: 'sql', sql: 'SELECT 1' }).type).toBe('mongodb.sql_to_mql')
  })

  it('returns null for an unrestorable or unknown type and for null input', () => {
    expect(restoreWorkspace({ id: 'x', type: 'app.quickstart' })).toBe(null)
    expect(restoreWorkspace({ id: 'y', type: 'no.such.type' })).toBe(null)
    expect(restoreWorkspace({ id: 'z', kind: 'collection' })).toBe(null)
    expect(restoreWorkspace(null)).toBe(null)
  })

  it('gives restored shells a fresh session from the injected source', () => {
    const tab = restoreWorkspace({
      id: 'sh', type: 'mongodb.shell', title: 'mongosh: shop', color: null, target: createResourceRef('c1', [{ kind: 'database', name: 'shop' }]),
      connectionId: 'c1', connectionName: 'Sales', dbName: 'shop',
      sessionId: 'old-session', code: 'db.orders.find()', scriptPath: null,
    }, { ids: { session: () => 'fresh-session' } })
    expect(tab.sessionId).toBe('fresh-session')
    expect(tab.code).toBe('db.orders.find()')
  })
})

describe('disposeWorkspace', () => {
  it('is a no-op when the definition has no dispose hook', async () => {
    await expect(disposeWorkspace(FIND)).resolves.toBeUndefined()
  })

  it('supports synchronous and asynchronous disposal', async () => {
    const sync = vi.fn()
    const asyncDispose = vi.fn(() => Promise.resolve())
    registerWorkspaceDefinition({
      type: 'test.sync-dispose', engine: 'test', component: null,
      create: () => ({ title: 'x', fields: {} }),
      dispose: sync,
    })
    registerWorkspaceDefinition({
      type: 'test.async-dispose', engine: 'test', component: null,
      create: () => ({ title: 'x', fields: {} }),
      dispose: asyncDispose,
    })
    await disposeWorkspace({ id: 'x', type: 'test.sync-dispose' })
    await disposeWorkspace({ id: 'x', type: 'test.async-dispose' })
    expect(sync).toHaveBeenCalledOnce()
    expect(asyncDispose).toHaveBeenCalledOnce()
  })

  it('contains disposal rejection', async () => {
    registerWorkspaceDefinition({
      type: 'test.rejecting-dispose', engine: 'test', component: null,
      create: () => ({ title: 'x', fields: {} }),
      dispose: () => Promise.reject(new Error('engine gone')),
    })
    await expect(disposeWorkspace({ id: 'x', type: 'test.rejecting-dispose' })).resolves.toBeUndefined()
  })

  it('is a no-op for a workspace without a type', async () => {
    await expect(disposeWorkspace({ id: 'x' })).resolves.toBeUndefined()
  })
})

describe('deepClone', () => {
  it('preserves undefined values where structuredClone is available', () => {
    const out = deepClone({ a: 1, scalar: undefined })
    expect(out).toEqual({ a: 1, scalar: undefined })
    expect('scalar' in out).toBe(true)
  })

  it('detaches nested containers', () => {
    const src = { rows: [{ x: 1 }] }
    const out = deepClone(src)
    out.rows[0].x = 2
    expect(src.rows[0].x).toBe(1)
  })
})

describe('affectedByResource', () => {
  const db = createResourceRef('c1', [{ kind: 'database', name: 'shop' }])
  const coll = createResourceRef('c1', [
    { kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' },
  ])
  const conn = createResourceRef('c1')
  const by = affectedByResource(db)

  it('matches the resource itself and everything under it', () => {
    expect(by({ target: db })).toBe(true)
    expect(by({ target: coll })).toBe(true)
  })

  it('does not match siblings, shallower scopes, or other connections', () => {
    expect(by({ target: conn })).toBe(false)
    expect(by({ target: createResourceRef('c2', [{ kind: 'database', name: 'shop' }]) })).toBe(false)
    expect(by({ target: createResourceRef('c1', [{ kind: 'database', name: 'other' }]) })).toBe(false)
  })

  it('ignores workspaces without a target', () => {
    expect(by({ target: null })).toBe(false)
    expect(by({ type: 'app.quickstart' })).toBe(false)
    expect(affectedByResource(conn)({ target: coll })).toBe(true)
  })
})

describe('retargetResource', () => {
  const conn = 'c1'
  const orders = createResourceRef(conn, [
    { kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' },
  ])
  const sales = createResourceRef(conn, [
    { kind: 'database', name: 'shop' }, { kind: 'collection', name: 'sales' },
  ])
  const shop = createResourceRef(conn, [{ kind: 'database', name: 'shop' }])
  const archive = createResourceRef(conn, [{ kind: 'database', name: 'archive' }])

  function tab(extra) {
    return { type: 'mongodb.find', target: orders, title: 'orders', ...extra }
  }

  it('rewrites the target of the renamed resource itself', () => {
    const t = tab()
    expect(retargetResource(orders, sales)(t)).toBe(true)
    expect(t.target).toEqual(sales)
  })

  // The regression this exists for: rename left `target` on the old name, so
  // affectedByResource stopped matching and a later drop never closed the tab.
  it('leaves the retargeted workspace findable by the new resource', () => {
    const t = tab()
    retargetResource(orders, sales)(t)
    expect(affectedByResource(sales)(t)).toBe(true)
    expect(affectedByResource(orders)(t)).toBe(false)
  })

  it('rewrites descendants when a parent is renamed', () => {
    const t = tab()
    retargetResource(shop, archive)(t)
    expect(t.target).toEqual(createResourceRef(conn, [
      { kind: 'database', name: 'archive' }, { kind: 'collection', name: 'orders' },
    ]))
  })

  it('leaves unrelated workspaces untouched', () => {
    const other = tab({ target: createResourceRef(conn, [
      { kind: 'database', name: 'shop' }, { kind: 'collection', name: 'invoices' },
    ]) })
    const before = other.target
    expect(retargetResource(orders, sales)(other)).toBe(false)
    expect(other.target).toBe(before)
  })

  it('ignores workspaces with no target', () => {
    const home = { type: 'app.quickstart', target: null }
    expect(retargetResource(orders, sales)(home)).toBe(false)
  })

  // The target is a workspace's whole identity (#303), so a rename moves only it.
  // Current Operations' dbName/collName are the user's *filters*; a rename must never
  // rewrite them, or it would silently change what the user is watching.
  it('moves only the target, never a filter that names the same thing', () => {
    const t = tab({ dbName: 'shop', collName: 'orders' })
    retargetResource(orders, sales)(t)
    expect(t.target).toEqual(sales)
    expect([t.dbName, t.collName]).toEqual(['shop', 'orders'])
  })

  // A PostgreSQL table tab reads its schema and table off its target each time it
  // activates, so the target is what a rename has to move.
  it('moves a PostgreSQL table tab to the renamed table and schema', () => {
    const at = (schema, table) => createResourceRef(conn, [
      { kind: 'database', name: 'app' }, { kind: 'schema', name: schema }, { kind: 'table', name: table },
    ])
    const pg = { type: 'postgresql.table_browse', target: at('public', 'users'), title: 'users' }
    retargetResource(at('public', 'users'), at('public', 'people'))(pg)
    expect([pg.target, pg.title]).toEqual([at('public', 'people'), 'people'])

    const schemaOnly = (name) => createResourceRef(conn, [{ kind: 'database', name: 'app' }, { kind: 'schema', name }])
    retargetResource(schemaOnly('public'), schemaOnly('crm'))(pg)
    expect(pg.target).toEqual(at('crm', 'people'))
  })

  // A tab the user renamed by hand keeps its title; only the default one follows.
  it('retitles only when the title still matches the old name', () => {
    const untouched = tab({ title: 'orders' })
    const custom = tab({ title: 'my working set' })
    retargetResource(orders, sales)(untouched)
    retargetResource(orders, sales)(custom)
    expect(untouched.title).toBe('sales')
    expect(custom.title).toBe('my working set')
  })
})

describe('canRefreshWorkspace', () => {
  it('reloads the views that only read', () => {
    for (const type of ['mongodb.find', 'mongodb.indexes', 'mongodb.schema', 'mongodb.current_operations']) {
      expect(canRefreshWorkspace({ type }), type).toBe(true)
    }
  })

  it('never re-runs what can change data, nor a tab with nothing to reload', () => {
    const types = ['mongodb.aggregate', 'mongodb.sql_to_mql', 'mongodb.shell', 'mongodb.import', 'mongodb.export',
      'mongodb.search', 'postgresql.query', 'app.quickstart']
    for (const type of types) expect(canRefreshWorkspace({ type }), type).toBe(false)
    expect(canRefreshWorkspace(null)).toBe(false)
  })

  it('reloads a PostgreSQL table tab in Filter mode, never its SQL', () => {
    expect(canRefreshWorkspace({ type: 'postgresql.table_browse', state: { mode: 'filter' } })).toBe(true)
    expect(canRefreshWorkspace({ type: 'postgresql.table_browse', state: { mode: 'sql' } })).toBe(false)
  })
})
