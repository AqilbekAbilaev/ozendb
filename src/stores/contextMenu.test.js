import { beforeEach, describe, expect, it } from 'vitest'
import { contextMenu, contextActiveNodeKey } from './contextMenu'

beforeEach(() => { contextMenu.value = null })

describe('contextActiveNodeKey', () => {
  it('is null with no menu open', () => {
    expect(contextActiveNodeKey.value).toBeNull()
  })

  it('names the tree node the menu was opened on', () => {
    contextMenu.value = { type: 'connection', nodeData: { connId: 'c1' } }
    expect(contextActiveNodeKey.value).toBe('c1')
    contextMenu.value = { type: 'database', nodeData: { connId: 'c1', dbName: 'shop' } }
    expect(contextActiveNodeKey.value).toBe('c1/shop')
    contextMenu.value = { type: 'collection', nodeData: { connId: 'c1', dbName: 'shop', collName: 'a/b' } }
    expect(contextActiveNodeKey.value).toBe('c1/shop/a/b')
  })

  // A tab menu has no tree node; it used to fall into the collection branch and hand
  // the sidebar "undefined/undefined/undefined" to highlight.
  it('is null for a menu that is not on a tree node', () => {
    contextMenu.value = { type: 'tab', nodeData: { tabId: 't1' } }
    expect(contextActiveNodeKey.value).toBeNull()
  })
})
