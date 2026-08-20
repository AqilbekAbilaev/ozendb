import { describe, it, expect, vi } from 'vitest'
import { createWorkspace } from './createWorkspace'
import { registerWorkspaceDefinition, getWorkspaceDefinition } from './registry'

// The factory is exercised through both a real definition (mongodb.find — the
// richest legacy shape) and local spy definitions that probe the envelope rules.
// Local types are unique to this file; vitest gives every test file a fresh module
// registry, so they cannot collide with the real registration.
import { registerWorkspaceDefinitions } from './registerDefinitions'

// Once per file: the definitions map is module-scope, so registering in a hook would
// throw on the second test.
registerWorkspaceDefinitions()

function deepFreeze(obj) {
  Object.freeze(obj)
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') deepFreeze(v)
  }
  return obj
}

const COLLECTION_TARGET = {
  connectionId: 'c1', connectionName: 'Sales', dbName: 'shop', collectionName: 'orders',
}

describe('createWorkspace — type resolution', () => {
  it('fails clearly for an unknown type', () => {
    expect(() => createWorkspace('no.such.type', {})).toThrow(/Unknown workspace type: no\.such\.type/)
  })

  it('looks up definitions through the registry', () => {
    registerWorkspaceDefinition({
      type: 'test.probe', engine: 'test', component: null,
      create: () => ({ title: 'Probe', fields: {} }),
    })
    expect(getWorkspaceDefinition('test.probe').type).toBe('test.probe')
  })

  it('rejects a duplicate registration', () => {
    const def = { type: 'test.dup', engine: 'test', component: null, create: () => ({ title: 'x', fields: {} }) }
    registerWorkspaceDefinition(def)
    expect(() => registerWorkspaceDefinition({ ...def })).toThrow(/Duplicate workspace type: test\.dup/)
  })
})

describe('createWorkspace — envelope', () => {
  it('owns the id centrally', () => {
    const tab = createWorkspace('mongodb.find', {
      target: COLLECTION_TARGET,
      ids: { workspace: () => 'w-42' },
    })
    expect(tab.id).toBe('w-42')
  })

  it('issues a fresh id when none is injected', () => {
    const a = createWorkspace('mongodb.find', { target: COLLECTION_TARGET })
    const b = createWorkspace('mongodb.find', { target: COLLECTION_TARGET })
    expect(a.id).not.toBe(b.id)
  })

  it('sets the canonical type and engine', () => {
    const tab = createWorkspace('mongodb.find', { target: COLLECTION_TARGET })
    expect(tab.type).toBe('mongodb.find')
    expect(tab.engine).toBe('mongodb')
    expect(tab.color).toBe(null)
  })

  it('definitions cannot override common envelope fields', () => {
    registerWorkspaceDefinition({
      type: 'test.smuggler', engine: 'test', component: null,
      create: () => ({
        title: 'Real title',
        fields: { id: 'evil', type: 'evil', engine: 'evil', color: 'evil', target: 'evil', title: 'evil', kind: 'x' },
      }),
    })
    const tab = createWorkspace('test.smuggler', { ids: { workspace: () => 'w-1' } })
    expect(tab.id).toBe('w-1')
    expect(tab.type).toBe('test.smuggler')
    expect(tab.engine).toBe('test')
    expect(tab.title).toBe('Real title')
    expect(tab.color).toBe(null)
    expect(tab.target).toBe(null)
    expect(tab.kind).toBe('x') // engine fields themselves are untouched
  })
})

describe('createWorkspace — context contract', () => {
  it('hands the definition its explicit context', () => {
    const create = vi.fn(() => ({ title: 'T', fields: {} }))
    registerWorkspaceDefinition({ type: 'test.ctx', engine: 'test', component: null, create })
    const target = deepFreeze({ connId: 'c1', dbName: 'db' })
    const defaults = deepFreeze({ queryLimit: 25 })
    const options = deepFreeze({ source: 'query' })
    createWorkspace('test.ctx', { target, defaults, options, ids: { workspace: () => 'w-1', session: () => 's-1' } })
    expect(create).toHaveBeenCalledWith({
      target,
      defaults,
      options,
      ids: expect.objectContaining({
        workspace: expect.any(Function),
        session: expect.any(Function),
      }),
    })
  })

  it('does not mutate the input target or options', () => {
    const target = deepFreeze(COLLECTION_TARGET)
    const options = deepFreeze({ format: 'csv' })
    expect(() => createWorkspace('mongodb.find', { target, options })).not.toThrow()
  })

  it('gives the shell definition its injected session id source', () => {
    const tab = createWorkspace('mongodb.shell', {
      target: { connectionId: 'c1', connectionName: 'Sales', dbName: 'shop' },
      ids: { workspace: () => 'w-1', session: () => 'sess-9' },
    })
    expect(tab.sessionId).toBe('sess-9')
    expect(tab.id).toBe('w-1')
  })
})

describe('createWorkspace — fresh mutable state', () => {
  it('never shares mutable containers between workspaces', () => {
    const a = createWorkspace('mongodb.find', { target: COLLECTION_TARGET })
    const b = createWorkspace('mongodb.find', { target: COLLECTION_TARGET })
    expect(a.results).not.toBe(b.results)
    expect(a.selectedRows).not.toBe(b.selectedRows)
    a.results.push({ x: 1 })
    expect(b.results).toEqual([])
  })

  it('allocates fresh nested import options per workspace', () => {
    const a = createWorkspace('mongodb.import', {
      target: { connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders' },
      options: { format: 'csv' },
    })
    const b = createWorkspace('mongodb.import', {
      target: { connId: 'c1', connName: 'Sales', dbName: 'shop', collName: 'orders' },
      options: { format: 'csv' },
    })
    expect(a.csv).not.toBe(b.csv)
    a.csv.delimiter = ';'
    expect(b.csv.delimiter).toBe(',')
  })

  it('allocates fresh current-operations arrays per workspace', () => {
    const a = createWorkspace('mongodb.current_operations', { target: { connId: 'c1', connName: 'Sales' } })
    const b = createWorkspace('mongodb.current_operations', { target: { connId: 'c1', connName: 'Sales' } })
    expect(a.ops).not.toBe(b.ops)
    expect(a.results).not.toBe(b.results)
    expect(a.colOrder).not.toBe(b.colOrder)
  })
})