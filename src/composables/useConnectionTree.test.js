import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'

vi.mock('vue', async importOriginal => ({
  ...await importOriginal(),
  onMounted: vi.fn(),
  onUnmounted: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('../engines/mongodb/api/resources', () => ({ listDatabases: vi.fn() }))
vi.mock('../engines/postgresql/api/resources', async (original) => ({ ...(await original()), listSchemas: vi.fn() }))
vi.mock('../engines/mysql/api/resources', async (original) => ({ ...(await original()), listDatabases: vi.fn() }))
vi.mock('../appApi/connectionState', () => ({ setConnectionOpen: vi.fn() }))

import { onMounted, onUnmounted } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { listDatabases } from '../engines/mongodb/api/resources'
import { listSchemas } from '../engines/postgresql/api/resources'
import { listDatabases as listMySqlDatabases } from '../engines/mysql/api/resources'
import { registerWorkspaceDefinitions } from '../workspaces/registerDefinitions'
import { connDatabases, clearConnectionResources, invalidateConnectionResources, refreshConnectionResources } from '../stores/connectionData'
import { consumeConnectionOpenRequest, requestConnectionOpen, setTreeSelection, treeSelection } from '../stores/connectionNavigation'
import { tabs, activeTabId } from '../stores/tabs'
import { useConnectionTree } from './useConnectionTree'
import { createResourceRef, resourceName } from '../utils/resourceRef'

// The tree asks each tab's definition whether it browses a table.
registerWorkspaceDefinitions()

let scope
let tree
const conn = { id: 'a', name: 'Connection' }

beforeEach(() => {
  vi.resetAllMocks()
  clearConnectionResources('a')
  consumeConnectionOpenRequest()
  tabs.value = []
  activeTabId.value = null
  scope = effectScope()
  tree = scope.run(() => useConnectionTree())
  tree.connections.value = [conn]
})
afterEach(() => scope.stop())

it('reuses an empty cached list on re-expansion', async () => {
  listDatabases.mockResolvedValue([])
  await tree.toggleConnection(conn)
  await tree.toggleConnection(conn)
  await tree.toggleConnection(conn)
  expect(listDatabases).toHaveBeenCalledOnce()
})

it('opens a requested connection through the navigation store', async () => {
  listDatabases.mockResolvedValue([])
  requestConnectionOpen('a')
  await vi.waitFor(() => expect(tree.expandedConns.value.a).toBe(true))
  expect(listDatabases).toHaveBeenCalledWith('a')
})

// A restored PostgreSQL table tab is useless to the tree while its connection is
// collapsed: the row that carries the highlight isn't rendered at all.
it('expands the connection of an active PostgreSQL table tab', async () => {
  listSchemas.mockResolvedValue([])
  tree.connections.value = [{ id: 'a', name: 'Connection', engine: 'postgresql' }]
  tabs.value = [{
    id: 'pg', type: 'postgresql.table_browse', target: createResourceRef('a', [{ kind: 'database', name: 'payments' }, { kind: 'schema', name: 'public' }, { kind: 'table', name: 'merchants' }]),
    connectionId: 'a', database: 'payments', schema: 'public', table: 'merchants',
  }]
  activeTabId.value = 'pg'
  await vi.waitFor(() => expect(tree.expandedConns.value.a).toBe(true))
  expect(listSchemas).toHaveBeenCalledWith('a')
})

// The tree asks the tab's definition, not its engine, so every SQL engine's table tab counts.
it('expands and names the connection of an active MySQL table tab', async () => {
  listMySqlDatabases.mockResolvedValue([])
  tree.connections.value = [{ id: 'a', name: 'Connection', engine: 'mysql' }]
  tabs.value = [{
    id: 'my', type: 'mysql.table_browse',
    target: createResourceRef('a', [{ kind: 'database', name: 'shop.eu' }, { kind: 'table', name: 'order items' }]),
  }]
  activeTabId.value = 'my'
  await vi.waitFor(() => expect(tree.expandedConns.value.a).toBe(true))
  expect(tree.activeConnectionId.value).toBe('a')
  expect(listMySqlDatabases).toHaveBeenCalledWith('a')
})

// The shared tree only expands the connection; MongoDB's own tree opens the database.
it('expands the connection of an active MongoDB collection tab', async () => {
  listDatabases.mockResolvedValue([])
  tabs.value = [{
    id: 'mongo', type: 'mongodb.find',
    target: createResourceRef('a', [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }]),
  }]
  activeTabId.value = 'mongo'
  await vi.waitFor(() => expect(tree.expandedConns.value.a).toBe(true))
})

// The connection row used to prefix-match the collection key, so it lit up for MongoDB
// collections only — and would have matched any connection whose id was a prefix.
it('names the connection holding the active tab\'s resource, either engine', async () => {
  listDatabases.mockResolvedValue([])
  tabs.value = [
    { id: 'm', type: 'mongodb.find', target: createResourceRef('a', [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }]) },
    { id: 'p', type: 'postgresql.table_browse', target: createResourceRef('a', [{ kind: 'database', name: 'payments' }, { kind: 'schema', name: 'public' }, { kind: 'table', name: 'merchants' }]), connectionId: 'a', database: 'payments', schema: 'public', table: 'merchants' },
    { id: 'q', type: 'app.quickstart' },
  ]
  activeTabId.value = 'm'
  expect(tree.activeConnectionId.value).toBe('a')
  activeTabId.value = 'p'
  expect(tree.activeConnectionId.value).toBe('a')
  activeTabId.value = 'q'
  expect(tree.activeConnectionId.value).toBeNull()
})

it('refreshes a collapsed connection through the resource store', async () => {
  listDatabases.mockResolvedValueOnce([]).mockResolvedValueOnce([{ name: 'new' }])
  await tree.toggleConnection(conn)
  await tree.toggleConnection(conn)
  await refreshConnectionResources('a')
  expect(connDatabases.value.a).toEqual([{ name: 'new' }])
  expect(tree.expandedConns.value.a).toBe(false)
})

it('shows store background errors and retries with fresh data', async () => {
  listDatabases.mockResolvedValueOnce([]).mockRejectedValueOnce('Unavailable').mockResolvedValueOnce([{ name: 'new' }])
  await tree.toggleConnection(conn)
  invalidateConnectionResources('a')
  await vi.waitFor(() => expect(tree.connErrors.value.a).toEqual({ message: 'Unavailable', code: null }))
  await tree.retryConnection(conn)
  expect(tree.connErrors.value.a).toBeUndefined()
  expect(tree.expandedConns.value.a).toBe(true)
  expect(connDatabases.value.a).toEqual([{ name: 'new' }])
})

it('collapses failed initial discovery and expands on successful retry', async () => {
  const error = { code: 'network', message: 'Offline' }
  listDatabases.mockRejectedValueOnce(error).mockResolvedValueOnce([])
  await tree.toggleConnection(conn)
  expect(tree.expandedConns.value.a).toBe(false)
  expect(tree.connErrors.value.a).toEqual(error)
  await tree.retryConnection(conn)
  expect(tree.expandedConns.value.a).toBe(true)
  expect(tree.connErrors.value.a).toBeUndefined()
})

it('does not repopulate disconnected data when discovery finishes late', async () => {
  let resolve
  listDatabases.mockReturnValue(new Promise(done => { resolve = done }))
  const request = tree.toggleConnection(conn)
  expect(tree.loadingConns.value.a).toBe(true)
  tree.disconnectConn('a', { persist: false })
  resolve([{ name: 'late' }])
  await request
  expect(connDatabases.value.a).toBeUndefined()
  expect(tree.loadingConns.value.a).toBeUndefined()
  expect(tree.connections.value).toEqual([])
})

// A selection is the row's ResourceRef plus the connection's name and engine. The ref is
// built here, where the clicked level is known for certain (#193).
it('records a resource ref for a selected connection', () => {
  const s = effectScope()
  const t = s.run(() => useConnectionTree())
  t.selectConnection(conn)
  expect(treeSelection.value).toEqual({
    resource: { connectionId: 'a', segments: [] }, connectionName: conn.name, engine: conn.engine,
  })
  s.stop()
})

// The native menu gates MongoDB actions on the selection, so it must know the engine.
it('records the selected connection\'s engine', () => {
  const s = effectScope()
  const t = s.run(() => useConnectionTree())
  t.selectConnection({ id: 'p', name: 'PG', engine: 'postgresql' })
  expect(treeSelection.value).toEqual(expect.objectContaining({ engine: 'postgresql' }))
  s.stop()
})

it('clears the resource ref along with the selection', () => {
  const s = effectScope()
  const t = s.run(() => useConnectionTree())
  t.selectConnection(conn)
  t.disconnectConn('a', { persist: false })
  expect(treeSelection.value).toBeNull()
  s.stop()
})

// A dropped handle leaves one live listener per mount, each firing against a dead tree.
it('unlistens from every backend event on unmount', async () => {
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  const offs = [vi.fn(), vi.fn(), vi.fn()]
  let call = 0
  listen.mockImplementation(() => Promise.resolve(offs[call++]))

  await onMounted.mock.calls.at(-1)[0]()
  expect(listen).toHaveBeenCalledTimes(3)

  onUnmounted.mock.calls.at(-1)[0]()
  await new Promise(r => setTimeout(r, 0))
  for (const off of offs) expect(off).toHaveBeenCalledTimes(1)
})

// #153: a keyboard tab switch never clicks outside the sidebar, so the selection
// used to outlive it and the native menu kept acting on the old row.
it('clears the selection when the active tab changes', async () => {
  tabs.value = [{ id: 't1', type: 'app.quickstart' }, { id: 't2', type: 'app.quickstart' }]
  activeTabId.value = 't1'
  await nextTick()
  setTreeSelection({ resource: createResourceRef('a', [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }]) })
  activeTabId.value = 't2'
  await nextTick()
  expect(treeSelection.value).toBeNull()
})

it('keeps the selection while the active tab stays put', async () => {
  tabs.value = [{ id: 't1', type: 'app.quickstart' }]
  activeTabId.value = 't1'
  await nextTick()
  setTreeSelection({ resource: createResourceRef('a', [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }]) })
  await nextTick()
  expect(resourceName(treeSelection.value.resource)).toBe('orders')
})

// #155: double-click, right-click Open Table and the auto-open after Create Table
// all go through openPostgresTable, which always opens a new tab, so none may leave the
// clicked row selected for the menu to act on.
it('clears a PostgreSQL selection when a table is opened by any route', async () => {
  const { openPostgresTable } = await import('../engines/postgresql/tabs')
  setTreeSelection({
    resource: createResourceRef('a', [
      { kind: 'database', name: 'app' }, { kind: 'schema', name: 'public' }, { kind: 'table', name: 'widgets' },
    ]),
    connectionId: 'a', connectionName: 'PG', engine: 'postgresql',
    database: 'app', schema: 'public', table: 'widgets', kind: 'table',
  })
  openPostgresTable({ connectionId: 'a', connectionName: 'PG', database: 'app', schema: 'public', table: 'widgets' })
  await nextTick()
  expect(treeSelection.value).toBeNull()
})
