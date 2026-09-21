import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

vi.mock('vue', async importOriginal => ({
  ...await importOriginal(),
  onMounted: vi.fn(),
  onUnmounted: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('../engines/mongodb/api/resources', () => ({ listDatabases: vi.fn() }))
vi.mock('../appApi/connectionState', () => ({ setConnectionOpen: vi.fn() }))

import { onMounted, onUnmounted } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { listDatabases } from '../engines/mongodb/api/resources'
import { connDatabases, clearConnectionResources, invalidateConnectionResources, refreshConnectionResources } from '../stores/connectionData'
import { consumeConnectionOpenRequest, requestConnectionOpen, treeSelection } from '../stores/connectionNavigation'
import { useConnectionTree } from './useConnectionTree'

let scope
let tree
const conn = { id: 'a', name: 'Connection' }

beforeEach(() => {
  vi.resetAllMocks()
  clearConnectionResources('a')
  consumeConnectionOpenRequest()
  scope = effectScope()
  tree = scope.run(() => useConnectionTree({ props: {}, emit: vi.fn() }))
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

// The selection payload dual-carries a canonical ResourceRef alongside the legacy
// flat fields, so consumers can move onto it before the flat ones are dropped. The
// ref is built here, where the clicked level is known for certain, rather than being
// re-inferred downstream from which fields happen to be set.
it('records a resource ref for a selected connection', () => {
  const emit = vi.fn()
  const s = effectScope()
  const t = s.run(() => useConnectionTree({ props: {}, emit }))
  t.selectConnection(conn)
  expect(treeSelection.value).toEqual(expect.objectContaining({
    resource: { connectionId: 'a', segments: [] },
    connectionId: 'a', kind: 'connection',
  }))
  s.stop()
})

it('records a resource ref for a selected database', () => {
  const emit = vi.fn()
  const s = effectScope()
  const t = s.run(() => useConnectionTree({ props: {}, emit }))
  t.toggleDatabase(conn, 'shop')
  expect(treeSelection.value).toEqual(expect.objectContaining({
    resource: { connectionId: 'a', segments: [{ kind: 'database', name: 'shop' }] },
    dbName: 'shop', kind: 'database',
  }))
  s.stop()
})

it('records a resource ref for a highlighted collection', () => {
  const emit = vi.fn()
  const s = effectScope()
  const t = s.run(() => useConnectionTree({ props: {}, emit }))
  t.highlightCollection(conn, { name: 'shop' }, 'orders')
  expect(treeSelection.value).toEqual(expect.objectContaining({
    resource: {
      connectionId: 'a',
      segments: [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }],
    },
    collectionName: 'orders', kind: 'collection',
  }))
  s.stop()
})

// Names are opaque: a collection called "a/b" must not be mistaken for two segments.
it('keeps a name containing a slash in one segment', () => {
  const emit = vi.fn()
  const s = effectScope()
  const t = s.run(() => useConnectionTree({ props: {}, emit }))
  t.highlightCollection(conn, { name: 'shop' }, 'a/b')
  expect(treeSelection.value.resource.segments).toEqual([
    { kind: 'database', name: 'shop' }, { kind: 'collection', name: 'a/b' },
  ])
  s.stop()
})

it('clears the resource ref along with the selection', () => {
  const emit = vi.fn()
  const s = effectScope()
  const t = s.run(() => useConnectionTree({ props: {}, emit }))
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
