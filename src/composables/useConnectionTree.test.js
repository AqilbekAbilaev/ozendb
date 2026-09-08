import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

vi.mock('vue', async importOriginal => ({
  ...await importOriginal(),
  onMounted: vi.fn(),
  onUnmounted: vi.fn(),
}))
vi.mock('../engines/mongodb/api/resources', () => ({ listDatabases: vi.fn() }))
vi.mock('../appApi/connectionState', () => ({ setConnectionOpen: vi.fn() }))

import { listDatabases } from '../engines/mongodb/api/resources'
import { connDatabases, clearConnectionResources, invalidateConnectionResources, refreshConnectionResources } from '../stores/connectionData'
import { consumeConnectionOpenRequest, requestConnectionOpen } from '../stores/connectionNavigation'
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
