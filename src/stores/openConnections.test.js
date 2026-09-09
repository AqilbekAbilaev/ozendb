import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('../engines/mongodb/api/connections', () => ({ listConnections: vi.fn() }))
vi.mock('../appApi/connectionState', () => ({ setConnectionOpen: vi.fn() }))
vi.mock('./connectionData', () => ({ clearConnectionResources: vi.fn() }))

import { listConnections } from '../engines/mongodb/api/connections'
import { setConnectionOpen } from '../appApi/connectionState'
import { clearConnectionResources } from './connectionData'
import {
  openConnections, loadOpenConnections, addOpenConnection,
  updateOpenConnection, closeConnection, openConnectionById, resetOpenConnections,
} from './openConnections'

const a = { id: 'a', name: 'Alpha', open: true }
const b = { id: 'b', name: 'Beta', open: true }
const closed = { id: 'c', name: 'Closed', open: false }

beforeEach(() => {
  vi.resetAllMocks()
  resetOpenConnections()
})

// The sidebar shows only what is open; the full saved list lives in the Connection
// Manager, so the store filters rather than holding everything.
it('loads only the connections flagged open', async () => {
  listConnections.mockResolvedValue([a, closed, b])
  await loadOpenConnections()
  expect(openConnections.value).toEqual([a, b])
})

it('loads once, however many callers ask', async () => {
  listConnections.mockResolvedValue([a])
  await Promise.all([loadOpenConnections(), loadOpenConnections(), loadOpenConnections()])
  expect(listConnections).toHaveBeenCalledOnce()
})

it('leaves the list empty when the load fails, rather than throwing at callers', async () => {
  listConnections.mockRejectedValue(new Error('nope'))
  await expect(loadOpenConnections()).resolves.toBeUndefined()
  expect(openConnections.value).toEqual([])
})

it('adds a newly opened connection, ignoring one already present', () => {
  addOpenConnection(a)
  addOpenConnection({ ...a, name: 'Renamed' })
  expect(openConnections.value).toEqual([a])
})

// Editing a *closed* connection must not make it appear in the sidebar.
it('updates a listed connection in place and ignores an unlisted one', () => {
  addOpenConnection(a)
  updateOpenConnection({ ...a, name: 'Renamed' })
  updateOpenConnection({ id: 'zz', name: 'Never opened' })
  expect(openConnections.value).toEqual([{ ...a, name: 'Renamed' }])
})

it('drops a closed connection and releases its cached databases', async () => {
  addOpenConnection(a)
  addOpenConnection(b)
  await closeConnection('a')
  expect(openConnections.value).toEqual([b])
  expect(clearConnectionResources).toHaveBeenCalledWith('a')
})

it('persists the closed state so it does not reopen after a restart', async () => {
  addOpenConnection(a)
  await closeConnection('a')
  expect(setConnectionOpen).toHaveBeenCalledWith('a', false)
})

// A deleted connection is already gone from storage, so writing open:false would
// either fail or resurrect a record.
it('skips persistence when the connection was deleted', async () => {
  addOpenConnection(a)
  await closeConnection('a', { persist: false })
  expect(setConnectionOpen).not.toHaveBeenCalled()
  expect(openConnections.value).toEqual([])
})

it('survives a persistence failure without leaving the connection listed', async () => {
  setConnectionOpen.mockRejectedValue(new Error('disk full'))
  addOpenConnection(a)
  await expect(closeConnection('a')).resolves.toBeUndefined()
  expect(openConnections.value).toEqual([])
})

// Reopening after a close must actually re-fetch; the load-once latch is not a
// permanent one.
it('re-fetches after a reset', async () => {
  listConnections.mockResolvedValue([a])
  await loadOpenConnections()
  resetOpenConnections()
  await loadOpenConnections()
  expect(listConnections).toHaveBeenCalledTimes(2)
})

// Opening a connection that is not in the sidebar yet: fetch its config, mark it
// open, and add just that one — never reload the whole list over the top of the
// user's current view.
it('opens a saved connection that is not currently listed', async () => {
  listConnections.mockResolvedValue([a, closed])
  const conn = await openConnectionById('c')
  expect(conn).toEqual(closed)
  expect(setConnectionOpen).toHaveBeenCalledWith('c', true)
  expect(openConnections.value).toEqual([closed])
})

it('returns the already-listed connection without re-fetching', async () => {
  addOpenConnection(a)
  expect(await openConnectionById('a')).toEqual(a)
  expect(listConnections).not.toHaveBeenCalled()
  expect(setConnectionOpen).not.toHaveBeenCalled()
})

it('returns null for an id that no longer exists', async () => {
  listConnections.mockResolvedValue([a])
  expect(await openConnectionById('gone')).toBe(null)
  expect(openConnections.value).toEqual([])
})
