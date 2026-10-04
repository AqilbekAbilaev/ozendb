import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

vi.mock('../engines/mongodb/api/documents', () => ({ replaceDocument: vi.fn() }))
vi.mock('../engines/mongodb/api/queries', () => ({ runFind: vi.fn() }))

import { useMongoCellActions } from './useMongoCellActions'

function setup({ tab, holder }) {
  return useMongoCellActions({
    activeTab: () => tab,
    holder: holder ? () => holder : undefined,
    drillPath: () => [],
    readonly: () => false,
    gridDocs: () => (holder ?? tab).results,
    selectedCol: ref(null),
    cells: { cellCtx: ref(null) },
    emit: vi.fn(),
  })
}

let written
beforeEach(() => {
  written = null
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(text => { written = text }) } })
})

// ozendb-4dt: a MongoDB tab keeps its results and selection in its runtime, while the
// shell and Current Operations hand over one flat object.
describe('useMongoCellActions holder', () => {
  it('reads results and selection from a separate holder when given one', () => {
    const tab = { id: 't', connectionId: 'c1', dbName: 'shop', collectionName: 'orders' }
    const holder = { results: [{ _id: 1 }, { _id: 2 }, { _id: 3 }], selectedRow: 2, selectedRows: [0, 2] }
    setup({ tab, holder }).copySelection()
    expect(JSON.parse(written)).toEqual([{ _id: 1 }, { _id: 3 }])
  })

  it('falls back to the tab itself as the holder', () => {
    const tab = { id: 't', results: [{ _id: 'a' }], selectedRow: 0, selectedRows: [0] }
    setup({ tab }).copySelection()
    expect(JSON.parse(written)).toEqual({ _id: 'a' })
  })
})
