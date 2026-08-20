import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The Index Manager pane owns the per-tab list and form; this composable only carries
// the shared surfaces (View Details, type-to-confirm Drop, Copy). These cases pin the
// API boundary, including the frozen drop target — a tab switch while the confirm
// modal is open must never redirect the drop — and the revision signal the pane
// watches to reload its own list after a confirmed drop.
vi.mock('../engines/mongodb/api/indexes', () => ({
  createIndex: vi.fn(),
  dropIndex: vi.fn(),
  indexStats: vi.fn(),
  listIndexes: vi.fn(),
  setIndexHidden: vi.fn(),
}))

const { useIndexes } = await import('./useIndexes')
const api = await import('../engines/mongodb/api/indexes')

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function harness() {
  const toasts = []
  const ix = useIndexes({ showToast: (m) => toasts.push(m) })
  ix.indexesTarget.value = { connId: 'c1', dbName: 'db', collName: 'coll' }
  return { ix, toasts }
}

describe('openDropIndexConfirm', () => {
  it('freezes the full target at open time, not just the name', () => {
    const { ix } = harness()
    ix.selectedIndex.value = { name: 'idx_a' }

    ix.openDropIndexConfirm()

    expect(ix.dropIndexTarget.value).toEqual({
      name: 'idx_a', connId: 'c1', dbName: 'db', collName: 'coll',
    })
  })

  it('refuses the _id index without opening the dialog', () => {
    const { ix } = harness()
    ix.selectedIndex.value = { name: '_id_' }

    ix.openDropIndexConfirm()

    expect(ix.dropIndexTarget.value).toBeNull()
  })
})

describe('confirmDropIndex', () => {
  it('drops from the frozen target even if the indexes target has moved on', async () => {
    const { ix } = harness()
    ix.selectedIndex.value = { name: 'idx_a' }
    ix.openDropIndexConfirm()
    // The user switched to another collection's Index Manager while the modal was up.
    ix.indexesTarget.value = { connId: 'c2', dbName: 'other', collName: 'other' }
    ix.dropIndexConfirmText.value = 'idx_a'
    api.dropIndex.mockResolvedValue(undefined)

    await ix.confirmDropIndex()

    expect(api.dropIndex).toHaveBeenCalledTimes(1)
    expect(api.dropIndex).toHaveBeenCalledWith(
      { connectionId: 'c1', database: 'db', collection: 'coll' },
      'idx_a',
    )
  })

  it('bumps the revision so the owning pane reloads its list', async () => {
    const { ix } = harness()
    ix.selectedIndex.value = { name: 'idx_a' }
    ix.openDropIndexConfirm()
    ix.dropIndexConfirmText.value = 'idx_a'
    api.dropIndex.mockResolvedValue(undefined)
    const before = ix.indexesRevision.value

    await ix.confirmDropIndex()

    expect(ix.indexesRevision.value).toBe(before + 1)
    expect(ix.dropIndexTarget.value).toBeNull()
  })

  it('does not drop when the typed name does not match', async () => {
    const { ix } = harness()
    ix.selectedIndex.value = { name: 'idx_a' }
    ix.openDropIndexConfirm()
    ix.dropIndexConfirmText.value = 'wrong'

    await ix.confirmDropIndex()

    expect(api.dropIndex).not.toHaveBeenCalled()
  })

  it('leaves the revision untouched when the drop fails', async () => {
    const { ix } = harness()
    ix.selectedIndex.value = { name: 'idx_a' }
    ix.openDropIndexConfirm()
    ix.dropIndexConfirmText.value = 'idx_a'
    api.dropIndex.mockRejectedValueOnce(new Error('boom'))
    const before = ix.indexesRevision.value

    await ix.confirmDropIndex()

    expect(ix.indexesRevision.value).toBe(before)
    expect(ix.dropIndexError.value).toBeTruthy()
  })
})

describe('openIndexDetails', () => {
  it('loads usage stats for the selected index', async () => {
    const { ix } = harness()
    ix.selectedIndex.value = { name: 'idx_a' }
    api.indexStats.mockResolvedValue([{ name: 'idx_a', accesses: { ops: 5 } }])

    await ix.openIndexDetails()

    expect(api.indexStats).toHaveBeenCalledWith({ connectionId: 'c1', database: 'db', collection: 'coll' })
    expect(ix.indexDetailsTarget.value).toEqual({ name: 'idx_a' })
    expect(ix.indexDetailsStats.value).toEqual({ name: 'idx_a', accesses: { ops: 5 } })
  })

  it('keeps showing the spec when $indexStats is unavailable', async () => {
    const { ix } = harness()
    ix.selectedIndex.value = { name: 'idx_a' }
    api.indexStats.mockRejectedValueOnce(new Error('no privilege'))

    await ix.openIndexDetails()

    expect(ix.indexDetailsTarget.value).toEqual({ name: 'idx_a' })
    expect(ix.indexDetailsStats.value).toBeNull()
  })
})

describe('copyIndex', () => {
  it('puts the pretty spec on the clipboard', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { ix } = harness()
    ix.selectedIndex.value = { name: 'idx_a', key: { a: 1 } }

    ix.copyIndex()

    expect(writeText).toHaveBeenCalledTimes(1)
  })
})