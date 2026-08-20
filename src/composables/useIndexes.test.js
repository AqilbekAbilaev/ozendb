import { describe, it, expect, vi, beforeEach } from 'vitest'

// The composable's local `dropIndex` and `setIndexHidden` used to shadow the imported
// API functions (same names, different signatures): an index edit armed the two-click
// guard instead of dropping, the confirmed drop recursed into itself, and hide/unhide
// never reached the backend. These cases pin the API boundary.
vi.mock('../engines/mongodb/api/indexes', () => ({
  createIndex: vi.fn(),
  dropIndex: vi.fn(),
  indexStats: vi.fn(),
  listIndexes: vi.fn(),
  setIndexHidden: vi.fn(),
}))
vi.mock('../engines/mongodb/api/admin', () => ({
  collectionStats: vi.fn(),
}))

const { useIndexes } = await import('./useIndexes')
const api = await import('../engines/mongodb/api/indexes')

beforeEach(() => {
  vi.clearAllMocks()
})

function harness() {
  const toasts = []
  const ix = useIndexes({ showToast: (m) => toasts.push(m) })
  return { ix, toasts }
}

describe('submitIndex', () => {
  it('drops the original before creating when editing', async () => {
    const { ix } = harness()
    api.listIndexes.mockResolvedValue([])
    await ix.openIndexes({ connId: 'c1', dbName: 'db', collName: 'coll' })
    ix.indexFormMode.value = 'edit'
    ix.indexEditOriginalName.value = 'old_1'
    api.createIndex.mockResolvedValue(undefined)
    api.dropIndex.mockResolvedValue(undefined)

    await ix.submitIndex({ keys: '{ "b": 1 }', options: '{}' })

    expect(api.dropIndex).toHaveBeenCalledTimes(1)
    expect(api.dropIndex.mock.calls[0]).toEqual([
      { connectionId: 'c1', database: 'db', collection: 'coll' },
      'old_1',
    ])
    expect(api.createIndex).toHaveBeenCalledTimes(1)
  })

  it('creates without dropping when adding', async () => {
    const { ix } = harness()
    api.listIndexes.mockResolvedValue([])
    await ix.openIndexes({ connId: 'c1', dbName: 'db', collName: 'coll' })
    api.createIndex.mockResolvedValue(undefined)

    await ix.submitIndex({ keys: '{ "a": 1 }', options: '{}' })

    expect(api.dropIndex).not.toHaveBeenCalled()
    expect(api.createIndex).toHaveBeenCalledTimes(1)
  })
})

describe('dropIndex (two-click row guard)', () => {
  it('arms on the first click and drops on the second, reaching the API once', async () => {
    const { ix } = harness()
    api.listIndexes.mockResolvedValue([])
    await ix.openIndexes({ connId: 'c1', dbName: 'db', collName: 'coll' })

    await ix.dropIndex('idx_a')
    expect(api.dropIndex).not.toHaveBeenCalled()
    expect(ix.pendingDropIndex.value).toBe('idx_a')

    api.dropIndex.mockResolvedValue(undefined)
    await ix.dropIndex('idx_a')

    expect(api.dropIndex).toHaveBeenCalledTimes(1)
    expect(api.dropIndex.mock.calls[0][1]).toBe('idx_a')
    expect(ix.pendingDropIndex.value).toBeNull()
  })
})

describe('confirmDropIndex (type-to-confirm dialog)', () => {
  it('reaches the API with the confirmed name', async () => {
    const { ix } = harness()
    api.listIndexes.mockResolvedValue([])
    await ix.openIndexes({ connId: 'c1', dbName: 'db', collName: 'coll' })
    ix.selectedIndex.value = { name: 'idx_b' }
    ix.openDropIndexConfirm()
    ix.dropIndexConfirmText.value = 'idx_b'
    api.dropIndex.mockResolvedValue(undefined)

    await ix.confirmDropIndex()

    expect(api.dropIndex).toHaveBeenCalledTimes(1)
    expect(api.dropIndex.mock.calls[0][1]).toBe('idx_b')
  })
})

describe('setIndexHidden', () => {
  it('reaches the API with the visibility flag', async () => {
    const { ix } = harness()
    api.listIndexes.mockResolvedValue([])
    await ix.openIndexes({ connId: 'c1', dbName: 'db', collName: 'coll' })
    ix.selectedIndex.value = { name: 'idx_c' }
    api.setIndexHidden.mockResolvedValue(undefined)

    await ix.setIndexHidden(true)

    expect(api.setIndexHidden).toHaveBeenCalledTimes(1)
    expect(api.setIndexHidden.mock.calls[0][1]).toBe('idx_c')
    expect(api.setIndexHidden.mock.calls[0][2]).toBe(true)
  })
})