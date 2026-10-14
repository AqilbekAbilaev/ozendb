import { beforeEach, describe, expect, it } from 'vitest'
import { contextMenu, contextActiveNodeKey, pgNodeKey } from './contextMenu'
import { appendResource, createResourceRef } from '../utils/resourceRef'

beforeEach(() => { contextMenu.value = null })

describe('contextActiveNodeKey', () => {
  it('is null with no menu open', () => {
    expect(contextActiveNodeKey.value).toBeNull()
  })

  it('names the tree node the menu was opened on', () => {
    const shop = createResourceRef('c1', [{ kind: 'database', name: 'shop' }])
    contextMenu.value = { type: 'connection', nodeData: { resource: createResourceRef('c1') } }
    expect(contextActiveNodeKey.value).toBe('c1')
    contextMenu.value = { type: 'database', nodeData: { resource: shop } }
    expect(contextActiveNodeKey.value).toBe('c1/shop')
    contextMenu.value = { type: 'collection', nodeData: { resource: appendResource(shop, 'collection', 'a/b') } }
    expect(contextActiveNodeKey.value).toBe('c1/shop/a/b')
  })

  it('names a PostgreSQL row by level, so a schema and a table of the same name stay apart', () => {
    const node = { connId: 'p1', database: 'payments', schema: 'a/b', table: 'c' }
    contextMenu.value = { type: 'pg:table', nodeData: node }
    expect(contextActiveNodeKey.value).toBe(pgNodeKey('table', node))
    contextMenu.value = { type: 'pg:schema', nodeData: { ...node, table: undefined } }
    expect(contextActiveNodeKey.value).toBe(pgNodeKey('schema', { connId: 'p1', schema: 'a/b' }))
    expect(pgNodeKey('schema', { connId: 'p1', schema: 'x' })).not.toBe(pgNodeKey('table', { connId: 'p1', schema: 'x', table: 'x' }))
    expect(pgNodeKey('schema', { connId: 'p1', schema: 'a/b' })).not.toBe(pgNodeKey('table', { connId: 'p1', schema: 'a', table: 'b' }))
  })

  // A tab menu has no tree node; it used to fall into the collection branch and hand
  // the sidebar "undefined/undefined/undefined" to highlight.
  it('is null for a menu that is not on a tree node', () => {
    contextMenu.value = { type: 'tab', nodeData: { tabId: 't1' } }
    expect(contextActiveNodeKey.value).toBeNull()
  })
})
