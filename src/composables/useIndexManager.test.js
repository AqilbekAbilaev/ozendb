import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../engines/mongodb/api/indexes', () => ({
  listIndexes: vi.fn(), indexStats: vi.fn(), createIndex: vi.fn(), dropIndex: vi.fn(), setIndexHidden: vi.fn(),
}))
vi.mock('../engines/mongodb/api/admin', () => ({ collectionStats: vi.fn() }))
vi.mock('../stores/toast', () => ({ showToast: vi.fn() }))

import { nextTick, ref } from 'vue'
import * as api from '../engines/mongodb/api/indexes'
import { collectionStats } from '../engines/mongodb/api/admin'
import { showToast } from '../stores/toast'
import { requestIndexAction } from '../stores/menuRequests'
import { useIndexManager } from './useIndexManager'

const ID = { name: '_id_', key: { _id: 1 } }
const BY_A = { name: 'a_1', key: { a: 1 } }
const tab = (id, coll = 'orders') => ({ id, connectionId: 'c1', dbName: 'shop', collectionName: coll })
const TARGET = { connectionId: 'c1', database: 'shop', collection: 'orders' }

// Lets every queued promise and watcher settle.
const settle = () => new Promise((r) => setTimeout(r, 0))

let current
function manager(initial = tab('t1')) {
  current = ref(initial)
  return useIndexManager(() => current.value)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.listIndexes.mockResolvedValue([ID, BY_A])
  collectionStats.mockResolvedValue({ indexes: [{ name: 'a_1', size: 8192 }], total_index_size: 12288 })
  api.indexStats.mockResolvedValue([{ name: 'a_1', accesses: { ops: 5 } }])
})
afterEach(() => { vi.unstubAllGlobals() })

describe('loading', () => {
  it('loads the active tab\'s indexes and their metrics straight away', async () => {
    const m = manager()
    await settle()
    expect(api.listIndexes).toHaveBeenCalledWith(TARGET)
    expect(m.localIndexesList.value).toEqual([ID, BY_A])
    expect(m.sizeOf(BY_A)).toBe('8.0 KB')
    expect(m.usageOf(BY_A)).toBe(5)
    expect(m.usageOf(ID)).toBe('n/a')
    expect(m.localIndexTotalSize.value).toBe(12288)
  })

  it('drops a response that arrives after the pane moved to another tab', async () => {
    let resolveFirst
    api.listIndexes.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r }))
    const m = manager()
    current.value = tab('t2', 'items')
    await settle()
    resolveFirst([{ name: 'stale_1', key: { s: 1 } }])
    await settle()
    expect(m.localIndexesList.value).toEqual([ID, BY_A])
  })
})

describe('edits', () => {
  it('refuses to edit or drop the _id index', async () => {
    const m = manager()
    await settle()
    m.selectRow(ID)
    m.handleStartEdit()
    m.handleDropIndex()
    expect(m.localIndexFormOpen.value).toBe(false)
    expect(showToast).toHaveBeenCalledWith('The _id index cannot be edited')
    expect(showToast).toHaveBeenCalledWith('The _id index cannot be dropped')
  })

  it('updates an index by dropping the old one and creating its replacement', async () => {
    const m = manager()
    await settle()
    m.selectRow(BY_A)
    m.handleStartEdit()
    expect(m.localIndexFormMode.value).toBe('edit')
    await m.submitIndex({ keys: '{ a: -1 }', options: '{}' })
    expect(api.dropIndex).toHaveBeenCalledWith(TARGET, 'a_1')
    expect(api.createIndex).toHaveBeenCalledWith(TARGET, '{ a: -1 }', '{}')
    expect(m.localIndexFormOpen.value).toBe(false)
    expect(showToast).toHaveBeenCalledWith('Index updated')
  })

  it('keeps a failed create in the form, with its error', async () => {
    api.createIndex.mockRejectedValue({ code: 'command', message: 'bad key' })
    const m = manager()
    await settle()
    m.openCreateIndex()
    await m.submitIndex({ keys: '{ a: 1 }' })
    expect(m.localIndexFormOpen.value).toBe(true)
    expect(m.localIndexesError.value).toBe('bad key')
  })
})

describe('native menu and clipboard', () => {
  it('runs an Index menu request against the open pane', async () => {
    const m = manager()
    await settle()
    m.selectRow(BY_A)
    requestIndexAction('setIndexHidden', true)
    await nextTick()
    await settle()
    expect(api.setIndexHidden).toHaveBeenCalledWith(TARGET, 'a_1', true)
  })

  it('opens the create form seeded from a copied spec, or says why it can\'t', async () => {
    const m = manager()
    await settle()
    vi.stubGlobal('navigator', { clipboard: { readText: vi.fn().mockResolvedValueOnce('nope').mockResolvedValueOnce('{"key":{"b":1},"name":"b_1"}') } })
    await m.pasteIndex()
    expect(showToast).toHaveBeenCalledWith('Clipboard is not a valid index spec')
    await m.pasteIndex()
    expect(m.localIndexFormOpen.value).toBe(true)
    expect(m.localIndexFormSeed.value).toEqual({ key: { b: 1 } })
  })
})
