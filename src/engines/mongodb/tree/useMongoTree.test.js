import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => new Promise(() => {})) }))
vi.mock('../api/queryLibrary', () => ({ getDefaultQuery: vi.fn() }))

import { registerWorkspaceDefinitions } from '../../../workspaces/registerDefinitions'
import { openConnections } from '../../../stores/openConnectionList'
import { closeConnection } from '../../../stores/openConnections'
import { treeSelection, setTreeSelection } from '../../../stores/connectionNavigation'
import { tabs, activeTabId } from '../../../stores/tabs'
import { createResourceRef } from '../../../utils/resourceRef'
import { nodeTagKey } from '../../../utils/tabColor'
import { useMongoTree } from './useMongoTree'

// Opening a collection builds its tab through the workspace definitions.
registerWorkspaceDefinitions()

const conn = { id: 'c1', name: 'Prod / EU', engine: 'mongodb' }
const shop = { name: 'shop.eu' }
const collectionRef = (database, collection) =>
  createResourceRef(conn.id, [{ kind: 'database', name: database }, { kind: 'collection', name: collection }])

let scope
let tree

beforeEach(() => {
  // Emptying the list forgets every connection's open databases, so no test sees another's.
  openConnections.value = []
  openConnections.value = [conn]
  setTreeSelection(null)
  tabs.value = []
  activeTabId.value = null
  scope = effectScope()
  tree = scope.run(() => useMongoTree())
})
afterEach(() => scope.stop())

it('selects a clicked database row by its ref, with the connection\'s name and engine', () => {
  tree.toggleDatabase(conn, 'shop.eu')
  expect(treeSelection.value).toEqual({
    resource: { connectionId: 'c1', segments: [{ kind: 'database', name: 'shop.eu' }] },
    connectionName: 'Prod / EU',
    engine: 'mongodb',
  })
})

it('opens a clicked database row and closes it on the next click', () => {
  tree.toggleDatabase(conn, 'shop.eu')
  expect(tree.isDatabaseOpen('c1', 'shop.eu')).toBe(true)
  tree.toggleDatabase(conn, 'shop.eu')
  expect(tree.isDatabaseOpen('c1', 'shop.eu')).toBe(false)
})

it('highlights a single-clicked collection by its ref', () => {
  tree.highlightCollection(conn, shop, 'orders 2024')
  expect(treeSelection.value.resource).toEqual(collectionRef('shop.eu', 'orders 2024'))
  expect(tree.selectedKey.value).toBe(tree.collectionKey('c1', 'shop.eu', 'orders 2024'))
})

// Names are opaque: a collection called "a/b" must not be mistaken for two segments.
it('keeps a collection name containing a slash or a dot in one segment', () => {
  tree.highlightCollection(conn, shop, 'logs/ü.2024')
  expect(treeSelection.value.resource.segments).toEqual([
    { kind: 'database', name: 'shop.eu' }, { kind: 'collection', name: 'logs/ü.2024' },
  ])
})

// Double-clicking a collection opens it the way every opener does: with a ref (#193).
it('opens a double-clicked collection as a tab with its ref and the connection\'s name', () => {
  tree.openCollection(conn, shop, 'orders 2024')
  expect(tabs.value).toHaveLength(1)
  expect(tabs.value[0].type).toBe('mongodb.find')
  expect(tabs.value[0].target).toEqual(collectionRef('shop.eu', 'orders 2024'))
  expect(tabs.value[0].connectionName).toBe('Prod / EU')
})

// The opened row lights up as the active collection; the single click before the double
// click must not linger as a second highlight once another tab becomes active.
it('clears the single-click selection when it opens a collection', () => {
  tree.highlightCollection(conn, shop, 'orders 2024')
  tree.openCollection(conn, shop, 'orders 2024')
  expect(treeSelection.value).toBeNull()
})

it('opens the database of the active MongoDB collection tab', async () => {
  tabs.value = [{ id: 'm', type: 'mongodb.find', target: collectionRef('shop.eu', 'orders 2024') }]
  activeTabId.value = 'm'
  await nextTick()
  expect(tree.isDatabaseOpen('c1', 'shop.eu')).toBe(true)
})

// Each connection's rows call useMongoTree, so the watcher is the module's, not theirs:
// a collapsed connection has no rows mounted and still gets its database opened.
it('opens the active collection tab\'s database with no tree mounted', async () => {
  scope.stop()
  tabs.value = [{ id: 'm', type: 'mongodb.find', target: collectionRef('shop.eu', 'orders 2024') }]
  activeTabId.value = 'm'
  await nextTick()
  scope = effectScope()
  tree = scope.run(() => useMongoTree())
  expect(tree.isDatabaseOpen('c1', 'shop.eu')).toBe(true)
})

// The rows look their state up by databaseKey/collectionKey, and the active tab writes it
// from its target: both go through nodeTagKey, so they cannot drift apart.
it('keys the active tab\'s rows the way the rows look themselves up', async () => {
  const target = collectionRef('shop.eu', 'logs/ü.2024')
  tabs.value = [{ id: 'm', type: 'mongodb.find', target }]
  activeTabId.value = 'm'
  await nextTick()
  expect(tree.activeCollectionKey.value).toBe(nodeTagKey(target))
  expect(tree.activeCollectionKey.value).toBe(tree.collectionKey('c1', 'shop.eu', 'logs/ü.2024'))
  tree.toggleDatabase(conn, 'shop.eu')
  expect(tree.isDatabaseOpen('c1', 'shop.eu')).toBe(false)
})

// The state lives outside any component, so a tree that is torn down and drawn again
// (as a collapsed connection's rows are) finds its databases as it left them.
it('remembers a connection\'s open databases across a new tree', () => {
  tree.toggleDatabase(conn, 'shop.eu')
  expect(tree.isDatabaseOpen('c1', 'shop.eu')).toBe(true)
  scope.stop()
  scope = effectScope()
  tree = scope.run(() => useMongoTree())
  expect(tree.isDatabaseOpen('c1', 'shop.eu')).toBe(true)
})

// Pruned off the open-connection list, not by a mounted tree: closing a connection whose
// rows are not on screen forgets its databases too.
it('forgets a connection\'s open databases when it closes, with no tree mounted', () => {
  tree.toggleDatabase(conn, 'shop.eu')
  expect(tree.isDatabaseOpen('c1', 'shop.eu')).toBe(true)
  scope.stop()
  closeConnection('c1', { persist: false })
  openConnections.value = [conn]
  scope = effectScope()
  tree = scope.run(() => useMongoTree())
  expect(tree.isDatabaseOpen('c1', 'shop.eu')).toBe(false)
})
