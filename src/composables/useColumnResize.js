import { ref, nextTick } from 'vue'

// Drag-to-resize and double-click-to-auto-fit for the result grid's columns. Owns the
// width map the table renders from; `{}` means auto layout, an entry pins that column
// to a pixel width.
//
// `gridColumns` is a getter rather than a ref because the component builds its column
// list further down its own setup than this is called — the same shape useColumnReorder
// takes for its inputs. It's only read during a gesture, long after setup has finished.
export function useColumnResize({ gridColumns }) {
  const tableRef  = ref(null)
  const colWidths = ref({})   // col name → px; empty = auto layout

  let resizeCol = null
  let resizeStartX = 0
  let resizeStartWidth = 0

  function startResize(e, col) {
    e.preventDefault()
    e.stopPropagation()
    // Measure only the column being dragged so we never snap all columns at once
    const cols     = gridColumns()
    const nthChild = cols.indexOf(col) + 2
    const th       = tableRef.value?.querySelector(`thead th:nth-child(${nthChild})`)
    resizeCol        = col
    resizeStartX     = e.clientX
    resizeStartWidth = th ? th.offsetWidth : (colWidths.value[col] || 80)
    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onResizeMove)
    document.addEventListener('mouseup',   stopResize)
  }

  function onResizeMove(e) {
    if (resizeCol === null) return
    colWidths.value[resizeCol] = Math.max(40, resizeStartWidth + (e.clientX - resizeStartX))
    // WebKit caches a sticky header cell's geometry and won't recompute its pinned
    // box just because its width changed — the line lags until something else
    // forces layout. Nudge a reflow once the new width has been applied to the DOM,
    // without touching `position`, so the header never jumps from its pinned spot.
    nextTick(() => { if (tableRef.value) void tableRef.value.offsetHeight })
  }

  function stopResize() {
    resizeCol = null
    document.body.style.cursor     = ''
    document.body.style.userSelect = ''
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup',   stopResize)
  }

  function autoFitColumn(e, col) {
    e.stopPropagation()
    if (!tableRef.value) return

    const cols = gridColumns()
    // +2: child 1 is the rownum column, data columns start at child 2
    const nthChild = cols.indexOf(col) + 2
    if (nthChild < 2) return

    // Header: measure label text with a throwaway element that inherits the th's computed font.
    // Can't use th.scrollWidth — in fixed layout it equals offsetWidth when cell > content.
    const th = tableRef.value.querySelector(`thead th:nth-child(${nthChild})`)
    let maxW = 40
    if (th) {
      const probe = document.createElement('span')
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${getComputedStyle(th).font}`
      probe.textContent = col === '_id' ? '{Document id}' : col
      document.body.appendChild(probe)
      maxW = probe.offsetWidth + 24  // 12px left + 12px right padding from th CSS
      document.body.removeChild(probe)
    }

    // Body cells: .tcell is display:inline-flex so its offsetWidth = intrinsic content size,
    // independent of how wide or narrow the parent td currently is.
    // Virtualized: only the mounted (visible) rows can be measured — the standard
    // trade-off. Auto-fit sizes to what's on screen, which is what the user sees.
    tableRef.value.querySelectorAll(`tbody tr.datarow td:nth-child(${nthChild}) .tcell`).forEach(tcell => {
      maxW = Math.max(maxW, tcell.offsetWidth + 24)  // 12px left + 12px right padding from td CSS
    })

    colWidths.value[col] = Math.ceil(maxW)
  }

  return { tableRef, colWidths, startResize, autoFitColumn }
}
