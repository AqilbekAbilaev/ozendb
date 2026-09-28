import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useRowSelection } from './useRowSelection'
import { gridKeyHandler } from './useResultKeyboard'

function setup({ rowCount = 5, holder = { selectedRow: -1, selectedRows: [], selectedField: null }, ...opts } = {}) {
  const rows = useRowSelection({ activeTab: () => holder })
  const cellCtx = ref(null)
  const copySelection = vi.fn()
  const scrollToRow = vi.fn()
  const onKey = gridKeyHandler({
    selection: () => holder, rows, rowCount: () => rowCount, columns: () => ['a', 'b', 'c'],
    editing: () => false, cellCtx, copySelection, scrollToRow, tableRef: ref(null), ...opts,
  })
  return { holder, rows, cellCtx, copySelection, scrollToRow, onKey }
}

const key = (k, mods = {}) => ({ key: k, target: { tagName: 'DIV' }, preventDefault: vi.fn(), ...mods })

describe('gridKeyHandler', () => {
  it('leaves keys typed into a field alone', () => {
    const g = setup()
    g.rows.setSingleRow(1)
    g.onKey(key('c', { metaKey: true, target: { tagName: 'INPUT' } }))
    g.onKey(key('ArrowDown', { target: { tagName: 'TEXTAREA' } }))
    expect(g.copySelection).not.toHaveBeenCalled()
    expect(g.holder.selectedRow).toBe(1)
  })

  it('does nothing while a cell is being edited', () => {
    const g = setup({ editing: () => true })
    g.rows.setSingleRow(1)
    g.onKey(key('ArrowDown'))
    expect(g.holder.selectedRow).toBe(1)
  })

  it('closes an open menu on Escape, keeping the selection', () => {
    const g = setup()
    g.rows.setSingleRow(2)
    g.cellCtx.value = { x: 0, y: 0, row: 2, col: 'a' }
    g.onKey(key('Escape'))
    expect(g.cellCtx.value).toBe(null)
    expect(g.holder.selectedRow).toBe(2)
  })

  it('selects every row on Cmd/Ctrl+A', () => {
    const g = setup({ rowCount: 3 })
    g.rows.selectedCol.value = 'b'
    g.onKey(key('a', { ctrlKey: true }))
    expect(g.holder.selectedRows).toEqual([0, 1, 2])
    expect(g.holder.selectedRow).toBe(2)
    expect(g.rows.selectedCol.value).toBe(null)
  })

  it('hands Cmd/Ctrl+V to onPaste when the grid takes pastes', () => {
    const onPaste = vi.fn()
    const g = setup({ onPaste })
    const e = key('v', { metaKey: true })
    g.onKey(e)
    expect(onPaste).toHaveBeenCalled()
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it('lets Cmd/Ctrl+V through when it does not', () => {
    const g = setup()
    const e = key('v', { metaKey: true })
    g.onKey(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('copies the selection on Cmd/Ctrl+C, and only with one', () => {
    const g = setup()
    g.onKey(key('c', { metaKey: true }))
    expect(g.copySelection).not.toHaveBeenCalled()
    g.rows.setSingleRow(0)
    g.onKey(key('c', { metaKey: true }))
    expect(g.copySelection).toHaveBeenCalledOnce()
  })

  it('clears the selection on Escape', () => {
    const g = setup()
    g.rows.setSingleRow(2)
    g.rows.selectedCol.value = 'a'
    g.onKey(key('Escape'))
    expect(g.holder.selectedRow).toBe(-1)
    expect(g.rows.selectedCol.value).toBe(null)
  })

  it('moves the cell with the arrows, stopping at the edges', () => {
    const g = setup({ rowCount: 2 })
    g.rows.setSingleRow(0)
    g.rows.selectedCol.value = 'a'
    g.onKey(key('ArrowLeft'))
    expect(g.rows.selectedCol.value).toBe('a')
    g.onKey(key('ArrowRight'))
    expect(g.rows.selectedCol.value).toBe('b')
    g.onKey(key('ArrowDown'))
    g.onKey(key('ArrowDown'))
    expect(g.holder.selectedRow).toBe(1)
    expect(g.scrollToRow).toHaveBeenLastCalledWith(1)
    g.onKey(key('ArrowUp'))
    expect(g.holder.selectedRow).toBe(0)
  })

  it('extends the rows with Shift+arrow', () => {
    const g = setup()
    g.rows.setSingleRow(1)
    g.onKey(key('ArrowDown', { shiftKey: true }))
    g.onKey(key('ArrowDown', { shiftKey: true }))
    expect(g.holder.selectedRows).toEqual([1, 2, 3])
  })
})
