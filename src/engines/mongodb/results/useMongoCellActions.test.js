import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'

vi.mock('../api/documents', () => ({ replaceDocument: vi.fn() }))
vi.mock('../api/queries', () => ({ runFind: vi.fn() }))

import { useMongoCellActions } from './useMongoCellActions'
import { createResourceRef } from '../../../utils/resourceRef'

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

// #157: a MongoDB tab keeps its results and selection in its runtime, while the
// shell and Current Operations hand over one flat object.
describe('useMongoCellActions holder', () => {
  it('reads results and selection from a separate holder when given one', () => {
    const tab = { id: 't', target: createResourceRef('c1', [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }]) }
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

// Follow Reference opens the referenced collection the way every opener does: with a
// ref and the connection's name (#193).
describe('Follow Reference', () => {
  function follow(dbRef) {
    const emit = vi.fn()
    const tab = { id: 't', target: target('shop', 'orders'), connectionName: 'Sales', results: [{ _id: 1, owner: dbRef }] }
    const cellCtx = ref({ row: 0, col: 'owner' })
    useMongoCellActions({
      activeTab: () => tab, drillPath: () => [], readonly: () => false,
      gridDocs: () => tab.results, selectedCol: ref(null), cells: { cellCtx }, emit,
    }).cellCtxPick('follow-reference')
    return emit
  }
  const target = (db, coll) => createResourceRef('c1', [{ kind: 'database', name: db }, { kind: 'collection', name: coll }])

  it('opens the referenced collection in the active tab\'s database', () => {
    const emit = follow({ $ref: 'users', $id: 7 })
    expect(emit).toHaveBeenCalledWith('follow-reference', {
      resource: target('shop', 'users'), connectionName: 'Sales', filter: '{ "_id": 7 }',
    })
  })

  it('opens it in the database the reference names', () => {
    const emit = follow({ $ref: 'users', $id: 7, $db: 'crm' })
    expect(emit.mock.calls[0][1].resource).toEqual(target('crm', 'users'))
  })

  it('follows nothing when the reference names no collection', () => {
    expect(follow({ $ref: '', $id: 7 })).not.toHaveBeenCalled()
  })
})
