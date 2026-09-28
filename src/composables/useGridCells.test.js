import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useRowSelection } from './useRowSelection'
import { useGridCells } from './useGridCells'

// The tab stands in for whatever holds the selection; see useRowSelection.test.js.
function setup(suppressNextClick) {
  const tab = { selectedRow: -1, selectedRows: [], selectedField: null }
  const rows = useRowSelection({ activeTab: () => tab })
  return { tab, rows, ...useGridCells({ rows, suppressNextClick }) }
}

const click = (mods = {}) => ({ shiftKey: false, metaKey: false, ctrlKey: false, ...mods })

describe('onCellClick', () => {
  it('selects the cell: its row alone, and its column', () => {
    const g = setup()
    g.onCellClick(click(), 2, 'name')
    expect(g.tab.selectedRows).toEqual([2])
    expect(g.rows.selectedCol.value).toBe('name')
  })

  it('extends a range with Shift, leaving no cell selected', () => {
    const g = setup()
    g.onCellClick(click(), 1, 'name')
    g.onCellClick(click({ shiftKey: true }), 3, 'name')
    expect(g.tab.selectedRows).toEqual([1, 2, 3])
    expect(g.rows.selectedCol.value).toBe(null)
  })

  it('toggles a row with Ctrl or Cmd', () => {
    const g = setup()
    g.onCellClick(click(), 1, 'name')
    g.onCellClick(click({ metaKey: true }), 4, 'name')
    expect(g.tab.selectedRows).toEqual([1, 4])
    g.onCellClick(click({ ctrlKey: true }), 1, 'name')
    expect(g.tab.selectedRows).toEqual([4])
  })

  it('closes an open menu', () => {
    const g = setup()
    g.openCellCtx({ preventDefault() {}, clientX: 5, clientY: 6 }, 0, 'name')
    g.onCellClick(click(), 1, 'name')
    expect(g.cellCtx.value).toBe(null)
  })

  it('swallows the click that ends a drag, once', () => {
    const suppress = ref(true)
    const g = setup(suppress)
    g.onCellClick(click(), 2, 'name')
    expect(g.tab.selectedRows).toEqual([])
    expect(suppress.value).toBe(false)
    g.onCellClick(click(), 2, 'name')
    expect(g.tab.selectedRows).toEqual([2])
  })
})

describe('selectRow', () => {
  it('applies the gesture to rows and drops the cell', () => {
    const g = setup()
    g.onCellClick(click(), 1, 'name')
    g.selectRow(click({ shiftKey: true }), 2)
    expect(g.tab.selectedRows).toEqual([1, 2])
    expect(g.rows.selectedCol.value).toBe(null)
  })
})

describe('openCellCtx', () => {
  it('selects the cell and opens the menu at the pointer, holding the browser menu back', () => {
    const g = setup()
    const preventDefault = vi.fn()
    g.openCellCtx({ preventDefault, clientX: 40, clientY: 50 }, 3, 'age')
    expect(preventDefault).toHaveBeenCalled()
    expect(g.tab.selectedRows).toEqual([3])
    expect(g.rows.selectedCol.value).toBe('age')
    expect(g.cellCtx.value).toEqual({ x: 40, y: 50, row: 3, col: 'age' })
  })
})
