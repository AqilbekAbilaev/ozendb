import { nextTick, onMounted, onUnmounted } from 'vue'

// A result grid's keys: arrows move the selected cell (Shift extends the rows),
// Cmd/Ctrl+A selects every row, Cmd/Ctrl+C copies, Escape backs out. `selection` is a
// getter for whatever holds the selected rows (a tab, a run) and `rows` the grid's
// useRowSelection. `onPaste` takes Cmd/Ctrl+V when given; `scrollToRow` brings a row
// into the window first when the grid doesn't mount them all.
export function gridKeyHandler({ selection, rows, rowCount, columns, editing, cellCtx, copySelection, onPaste, scrollToRow, tableRef }) {
  const { selectedCol, anchorRow, setSingleRow, selectRangeTo } = rows

  return function handleKeydown(e) {
    // Don't hijack keys while the user is typing in a field (query bar, modals,
    // inline cell editor) — otherwise arrow keys / Ctrl+C drive grid navigation
    // instead of the input.
    const t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    if (editing()) return
    const held = selection()
    if (!held) return

    if (e.key === 'Escape' && cellCtx.value) { cellCtx.value = null; return }

    const count = rowCount()

    // Ctrl/Cmd+A — select every fetched row. Works regardless of the current selection.
    if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
      if (!count) return
      e.preventDefault()
      held.selectedRows = Array.from({ length: count }, (_, i) => i)
      held.selectedRow = count - 1
      anchorRow.value = 0
      selectedCol.value = null
      return
    }

    // Ctrl/Cmd+V — the counterpart to Ctrl+C below; no row selection needed, so it sits
    // above the selection guard.
    if (onPaste && (e.metaKey || e.ctrlKey) && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault()
      onPaste()
      return
    }

    if (held.selectedRow < 0) return

    const cols   = columns()
    const colIdx = cols.indexOf(selectedCol.value)
    const rowIdx = held.selectedRow

    if ((e.metaKey || e.ctrlKey) && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault()
      copySelection()
      return
    }

    if (e.key === 'Escape') {
      setSingleRow(-1)
      selectedCol.value = null
      return
    }

    // Bring the selected row into the window first (it may not be mounted after a move),
    // then scroll its cell into view horizontally once it has rendered.
    const scrollToCell = () => {
      scrollToRow?.(held.selectedRow)
      nextTick(() =>
        tableRef.value?.querySelector('td.selcell')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      )
    }

    if (e.key === 'ArrowRight' && colIdx < cols.length - 1) {
      e.preventDefault()
      selectedCol.value = cols[colIdx + 1]
      scrollToCell()
    } else if (e.key === 'ArrowLeft' && colIdx > 0) {
      e.preventDefault()
      selectedCol.value = cols[colIdx - 1]
      scrollToCell()
    } else if (e.key === 'ArrowDown' && rowIdx < count - 1) {
      e.preventDefault()
      // Shift extends the selection from the anchor; a plain move re-anchors on the new row.
      if (e.shiftKey) selectRangeTo(rowIdx + 1)
      else setSingleRow(rowIdx + 1)
      scrollToCell()
    } else if (e.key === 'ArrowUp' && rowIdx > 0) {
      e.preventDefault()
      if (e.shiftKey) selectRangeTo(rowIdx - 1)
      else setSingleRow(rowIdx - 1)
      scrollToCell()
    }
  }
}

// Wires gridKeyHandler to the document for the grid's lifetime. `gridWrapRef` is the
// grid's scroll container.
export function useResultKeyboard({ gridWrapRef, ...options }) {
  const handleKeydown = gridKeyHandler(options)
  onMounted(()  => document.addEventListener('keydown', handleKeydown))
  onUnmounted(() => document.removeEventListener('keydown', handleKeydown))

  // WebKitGTK (the Linux Tauri webview) lets the grid's compositor layer go "cold"
  // while the window is backgrounded, so after switching back it won't repaint on
  // interaction until something forces an invalidation — the first scroll is absorbed
  // (row-number column flashes blank, snaps back) and rows don't highlight on hover
  // until you scroll/click once. Nudge the scroller by a pixel and back on focus
  // (with a forced reflow in between) to warm the layer before the user interacts.
  // The net scroll position is unchanged.
  function repaintGridOnFocus() {
    const el = gridWrapRef.value
    if (!el) return
    requestAnimationFrame(() => {
      const top = el.scrollTop
      el.scrollTop = top + 1
      void el.offsetHeight
      el.scrollTop = top
    })
  }
  onMounted(()  => window.addEventListener('focus', repaintGridOnFocus))
  onUnmounted(() => window.removeEventListener('focus', repaintGridOnFocus))
}
