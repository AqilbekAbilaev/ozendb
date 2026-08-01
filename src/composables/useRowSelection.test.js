import { describe, it, expect } from 'vitest'
import { nextTick } from 'vue'
import { useRowSelection } from './useRowSelection'

// A tab is a plain reactive-enough object in the app; the composable only ever reads and
// writes these three fields, so a literal stands in fine.
function makeTab(overrides = {}) {
  return { selectedRow: -1, selectedRows: [], selectedField: null, ...overrides }
}

function setup(tab) {
  return useRowSelection({ activeTab: () => tab })
}

describe('setSingleRow', () => {
  it('collapses the selection to one row and moves the anchor', () => {
    const tab = makeTab()
    const s = setup(tab)
    s.setSingleRow(3)
    expect(tab.selectedRow).toBe(3)
    expect(tab.selectedRows).toEqual([3])
    expect(s.anchorRow.value).toBe(3)
  })

  it('clears the selection on -1', () => {
    const tab = makeTab({ selectedRow: 2, selectedRows: [2] })
    const s = setup(tab)
    s.setSingleRow(-1)
    expect(tab.selectedRow).toBe(-1)
    expect(tab.selectedRows).toEqual([])
  })
})

describe('selectRangeTo', () => {
  it('selects from the anchor to the target', () => {
    const tab = makeTab()
    const s = setup(tab)
    s.setSingleRow(2)
    s.selectRangeTo(5)
    expect(tab.selectedRows).toEqual([2, 3, 4, 5])
    expect(tab.selectedRow).toBe(5)
  })

  it('works backwards from the anchor', () => {
    const tab = makeTab()
    const s = setup(tab)
    s.setSingleRow(5)
    s.selectRangeTo(2)
    expect(tab.selectedRows).toEqual([2, 3, 4, 5])
    expect(tab.selectedRow).toBe(2)
  })

  // The anchor staying put is what lets successive Shift moves grow and shrink the
  // range from one origin instead of walking it along.
  it('leaves the anchor untouched so the range can be re-extended', () => {
    const tab = makeTab()
    const s = setup(tab)
    s.setSingleRow(2)
    s.selectRangeTo(5)
    s.selectRangeTo(3)
    expect(s.anchorRow.value).toBe(2)
    expect(tab.selectedRows).toEqual([2, 3])
  })

  it('falls back to the target when there is no anchor', () => {
    const tab = makeTab()
    const s = setup(tab)
    s.selectRangeTo(4)
    expect(tab.selectedRows).toEqual([4])
  })
})

describe('toggleRow', () => {
  it('adds a row, keeping the set sorted', () => {
    const tab = makeTab()
    const s = setup(tab)
    s.setSingleRow(5)
    s.toggleRow(2)
    expect(tab.selectedRows).toEqual([2, 5])
    expect(tab.selectedRow).toBe(2)
  })

  it('removes an already-selected row and moves the active row to the last remaining', () => {
    const tab = makeTab({ selectedRow: 3, selectedRows: [1, 2, 3] })
    const s = setup(tab)
    s.toggleRow(3)
    expect(tab.selectedRows).toEqual([1, 2])
    expect(tab.selectedRow).toBe(2)
  })

  it('leaves no active row once the last selected row is toggled off', () => {
    const tab = makeTab({ selectedRow: 1, selectedRows: [1] })
    const s = setup(tab)
    s.toggleRow(1)
    expect(tab.selectedRows).toEqual([])
    expect(tab.selectedRow).toBe(-1)
  })
})

describe('isRowSelected', () => {
  it('reads the multi-row set when there is one', () => {
    const s = setup(makeTab({ selectedRow: 1, selectedRows: [1, 4] }))
    expect(s.isRowSelected(4)).toBe(true)
    expect(s.isRowSelected(2)).toBe(false)
  })

  // Tabs created before selectedRows existed only carry selectedRow.
  it('falls back to the single active row when the set is empty', () => {
    const s = setup(makeTab({ selectedRow: 2, selectedRows: [] }))
    expect(s.isRowSelected(2)).toBe(true)
    expect(s.isRowSelected(3)).toBe(false)
  })

  it('is false with no tab', () => {
    const s = useRowSelection({ activeTab: () => null })
    expect(s.isRowSelected(0)).toBe(false)
  })
})

describe('applyRowGesture', () => {
  it('routes shift to a range, ctrl/meta to a toggle, and plain to a single row', () => {
    const tab = makeTab()
    const s = setup(tab)

    s.applyRowGesture({}, 2)
    expect(tab.selectedRows).toEqual([2])

    s.applyRowGesture({ shiftKey: true }, 4)
    expect(tab.selectedRows).toEqual([2, 3, 4])

    s.applyRowGesture({ metaKey: true }, 3)
    expect(tab.selectedRows).toEqual([2, 4])
  })
})

describe('selectedCol', () => {
  it('mirrors onto the tab so the native menu can gate on it', async () => {
    const tab = makeTab()
    const s = setup(tab)
    s.selectedCol.value = 'name'
    await nextTick()
    expect(tab.selectedField).toBe('name')

    s.selectedCol.value = null
    await nextTick()
    expect(tab.selectedField).toBeNull()
  })
})
