import { ref, watch } from 'vue'

// Row and cell selection for the result grid. The selection itself lives on the tab
// (`selectedRow`, `selectedRows`, `selectedField`) rather than here, because the native
// menu's gates are driven from tab state — this owns the gestures that maintain it, plus
// the range anchor and the currently selected column.
//
// `activeTab` is a getter so the caller can hand over a prop without losing reactivity.
export function useRowSelection({ activeTab }) {
  const selectedCol = ref(null)  // the field/cell selected in the grid
  // Range anchor for Shift+click / Shift+Arrow multi-row selection. The active row is
  // tab.selectedRow; the full set is tab.selectedRows. Anchor is where the current range
  // started (a plain click / arrow move); it stays put while Shift extends the range.
  const anchorRow = ref(-1)

  // Is this grid row part of the current selection? Falls back to the single active row
  // for tabs that predate selectedRows (defensive; new tabs seed it to []).
  function isRowSelected(rowIdx) {
    const tab = activeTab()
    if (!tab) return false
    const rows = tab.selectedRows
    return rows && rows.length ? rows.includes(rowIdx) : tab.selectedRow === rowIdx
  }

  // Collapse to a single selected row (or clear with -1). Resets the range anchor.
  function setSingleRow(rowIdx) {
    const tab = activeTab()
    tab.selectedRow = rowIdx
    tab.selectedRows = rowIdx < 0 ? [] : [rowIdx]
    anchorRow.value = rowIdx
  }

  // Select the contiguous range from the anchor to rowIdx (Shift gesture). The anchor is
  // left untouched so successive Shift moves keep growing/shrinking from the same origin.
  function selectRangeTo(rowIdx) {
    const tab = activeTab()
    const from = anchorRow.value < 0 ? rowIdx : anchorRow.value
    const lo = Math.min(from, rowIdx)
    const hi = Math.max(from, rowIdx)
    const range = []
    for (let i = lo; i <= hi; i++) range.push(i)
    tab.selectedRows = range
    tab.selectedRow = rowIdx
  }

  // Toggle a single row in/out of the selection (Ctrl/Cmd+click) without disturbing the rest.
  function toggleRow(rowIdx) {
    const tab = activeTab()
    const set = new Set(tab.selectedRows && tab.selectedRows.length
      ? tab.selectedRows
      : (tab.selectedRow >= 0 ? [tab.selectedRow] : []))
    if (set.has(rowIdx)) set.delete(rowIdx)
    else set.add(rowIdx)
    const arr = [...set].sort((a, b) => a - b)
    tab.selectedRows = arr
    tab.selectedRow = set.has(rowIdx) ? rowIdx : (arr.length ? arr[arr.length - 1] : -1)
    anchorRow.value = rowIdx
  }

  // Apply a click gesture's modifiers to the row selection: Shift = range, Ctrl/Cmd =
  // toggle, plain = single.
  function applyRowGesture(e, rowIdx) {
    if (e.shiftKey) selectRangeTo(rowIdx)
    else if (e.metaKey || e.ctrlKey) toggleRow(rowIdx)
    else setSingleRow(rowIdx)
  }

  // Mirror the selected field onto the active tab so App.vue's menu context (and the
  // Document menu's field-scoped gates) can see it — ResultTable owns cell selection,
  // but the native menu is driven from tab state. Kept in sync with selectedCol so the
  // menu's "a field is selected" state always matches the highlighted cell.

  // Mirror the selected field onto the active tab so App.vue's menu context (and the
  // Document menu's field-scoped gates) can see it — this composable owns cell selection,
  // but the native menu is driven from tab state. Kept in sync with selectedCol so the
  // menu's "a field is selected" state always matches the highlighted cell.
  watch(selectedCol, (col) => {
    const tab = activeTab()
    if (tab) tab.selectedField = col || null
  })

  return {
    selectedCol,
    anchorRow,
    isRowSelected,
    setSingleRow,
    selectRangeTo,
    toggleRow,
    applyRowGesture,
  }
}
