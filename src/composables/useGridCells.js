import { ref } from 'vue'

// Clicking cells and rows, and opening a cell's right-click menu — the part of a result
// grid that doesn't care what a cell holds, shared by the MongoDB and PostgreSQL grids.
// `rows` is the grid's useRowSelection. `suppressNextClick` is set by a drag that ends
// over a cell, so the click it produces doesn't also select one.
export function useGridCells({ rows, suppressNextClick = ref(false) }) {
  const cellCtx = ref(null)   // { x, y, row, col } while a cell's menu is open

  function onCellClick(event, rowIdx, col) {
    if (suppressNextClick.value) {
      suppressNextClick.value = false
      return
    }
    if (event.shiftKey) rows.selectRangeTo(rowIdx)
    else if (event.metaKey || event.ctrlKey) rows.toggleRow(rowIdx)
    else {
      selectCell(rowIdx, col)
      return
    }
    rows.selectedCol.value = null
    cellCtx.value = null
  }

  function selectRow(event, rowIdx) {
    rows.applyRowGesture(event, rowIdx)
    rows.selectedCol.value = null
    cellCtx.value = null
  }

  function selectCell(rowIdx, col) {
    rows.setSingleRow(rowIdx)
    rows.selectedCol.value = col
    cellCtx.value = null
  }

  function openCellCtx(event, rowIdx, col) {
    event.preventDefault()
    selectCell(rowIdx, col)
    cellCtx.value = { x: event.clientX, y: event.clientY, row: rowIdx, col }
  }

  return { cellCtx, onCellClick, selectRow, selectCell, openCellCtx }
}
