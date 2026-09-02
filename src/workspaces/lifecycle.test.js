import { describe, it, expect, vi } from 'vitest'
import { duplicateWorkspace, restoreWorkspace, disposeWorkspace, deepClone, affectedByResource } from './lifecycle'
import { registerWorkspaceDefinition } from './registry'
import { registerWorkspaceDefinitions } from './registerDefinitions'
import { createResourceRef } from '../utils/resourceRef'

registerWorkspaceDefinitions()

const FIND = {
  id: 'f1', type: 'mongodb.find', engine: 'mongodb', title: 'orders',
  color: '#f00', target: createResourceRef('c1', [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }]),
  kind: 'collection', connectionId: 'c1', connectionName: 'Sales', dbName: 'shop', collectionName: 'orders',
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
    expect(dup.colOrder).not.toBe(FIND.colOrder)
    expect(dup.vqb).not.toBe(FIND.vqb)
    dup.colOrder.a = 99
    dup.vqb.rows.push(3)
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
    expect(dup.filter).toBe('{ "a": 1 }')
    expect(dup.results).toEqual([])
    expect(dup.hasRun).toBe(false)
    expect(dup.elapsedMs).toBe(null)
    expect(dup.selectedRow).toBe(-1)
    expect(dup.selectedRows).toEqual([])
  })

  it('returns null for an unsupported duplicate', () => {
    const quickstart = { id: 'q', type: 'app.quickstart', kind: 'quickstart', title: 'Quickstart' }
    expect(duplicateWorkspace(quickstart)).toBe(null)
  })

  it('fails clearly for an unknown type', () => {
    expect(() => duplicateWorkspace({ id: 'x', type: 'no.such.type' })).toThrow(/Unknown workspace type/)
  })
})

describe('restoreWorkspace', () => {
  const saved = {
    id: 'r1', kind: 'collection', title: 'orders', color: '#0f0',
    connectionId: 'c1', connectionName: 'Sales', dbName: 'shop', collectionName: 'orders',
    filter: '{ "a": 1 }', sort: '{}', projection: '{}', skip: 0, limit: 25,
    mode: 'find', pipeline: '', vqb: { rows: [1] }, colOrder: { a: 0 },
  }

  it('reconstructs through the saved kind and keeps the saved id', () => {
    const tab = restoreWorkspace(saved)
    expect(tab.id).toBe('r1')
    expect(tab.type).toBe('mongodb.find')
    expect(tab.engine).toBe('mongodb')
    expect(tab.color).toBe('#0f0')
    expect(tab.title).toBe('orders')
  })

  it('restores fresh runtime state and the one-shot initial-run marker', () => {
    const tab = restoreWorkspace(saved)
    expect(tab.filter).toBe('{ "a": 1 }')
    expect(tab.needsInitialRun).toBe(true)
    expect(tab.results).toEqual([])
    expect(tab.hasRun).toBe(false)
    expect(tab.selectedRow).toBe(-1)
  })

  it('maps SQL and aggregate saved records to their own types', () => {
    expect(restoreWorkspace({ ...saved, id: 'a', mode: 'aggregate', pipeline: '[{ "$match": {} }]' }).type).toBe('mongodb.aggregate')
    expect(restoreWorkspace({ ...saved, id: 's', mode: 'sql', sql: 'SELECT 1' }).type).toBe('mongodb.sql_to_mql')
  })

  it('returns null for records of unreadable kinds and null input', () => {
    expect(restoreWorkspace({ id: 'x', kind: 'quickstart' })).toBe(null)
    expect(restoreWorkspace(null)).toBe(null)
  })

  it('gives restored shells a fresh session from the injected source', () => {
    const tab = restoreWorkspace({
      id: 'sh', kind: 'shell', title: 'mongosh: shop', color: null,
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
    expect(by({ kind: 'quickstart' })).toBe(false)
    expect(affectedByResource(conn)({ target: coll })).toBe(true)
  })
})
