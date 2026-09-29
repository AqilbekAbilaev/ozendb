import { ref, computed, nextTick, onMounted } from 'vue'

// A width a column takes from its content — auto-fit, or the virtualized grid's default:
// never so wide that one long value pushes everything after it off-screen. 360px is the
// widest the grids show a cell (their CSS max-width); a drag can still go wider.
export const fitWidth = (width) => Math.min(360, Math.max(40, width))

// Drag-to-resize and double-click-to-auto-fit for the result grid's columns. Owns the
// width map the table renders from; `{}` means auto layout, an entry pins that column
// to a pixel width.
//
// `gridColumns` is a getter rather than a ref because the component builds its column
// list further down its own setup than this is called — the same shape useColumnReorder
// takes for its inputs. It's only read during a gesture, long after setup has finished.
//
// `cellData` is for a virtualized grid, whose columns must be pinned from the start (see
// colDefaultWidths). Without it the table keeps auto layout until a column is resized.
export function useColumnResize({ gridColumns, cellData, headerLabel: labelOf }) {
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

    // +2: child 1 is the rownum column, data columns start at child 2
    const nthChild = gridColumns().indexOf(col) + 2
    if (nthChild < 2) return

    // Virtualized: only the mounted (visible) rows can be measured — the standard
    // trade-off. Auto-fit sizes to what's on screen, which is what the user sees.
    // A colspan cell (spacer, "no rows" message) belongs to no one column.
    const cells = tableRef.value.querySelectorAll(
      `thead th:nth-child(${nthChild}), tbody td:nth-child(${nthChild}):not([colspan])`)
    colWidths.value[col] = fitWidth(naturalWidth(cells))
  }

  // The widest of `cells` at the size its content wants, padding and border included. The
  // cells themselves can't say: one in a narrowed column reports that column's width. So
  // each one's content is cloned into an off-screen probe with the cell's own font and
  // edges, and the probe — sized to its widest line — is laid out once for the lot. An
  // input (a header's filter box) fills whatever it's given, so it counts at its min-width.
  function naturalWidth(cells) {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;width:max-content'
    for (const cell of cells) {
      const s = getComputedStyle(cell)
      const line = document.createElement('div')
      line.style.cssText = `font:${s.font};padding:0 ${s.paddingRight} 0 ${s.paddingLeft};` +
        `border:solid transparent;border-width:0 ${s.borderRightWidth} 0 ${s.borderLeftWidth}`
      line.append(...[...cell.childNodes].map(node => node.cloneNode(true)))
      line.querySelectorAll('input').forEach(input => { input.style.width = '0' })
      probe.appendChild(line)
    }
    document.body.appendChild(probe)
    const width = Math.ceil(probe.getBoundingClientRect().width)
    probe.remove()
    return width
  }

  // Virtualization mounts only the visible rows, so auto table-layout would resize columns
  // to whatever is on screen as you scroll. Pin every column to a content-derived width so
  // they stay steady. The grid font is monospace, so width ≈ longest value's character
  // count × char width — measured once, no per-cell DOM work.
  const charW = ref(7.3)
  function measureCharW() {
    const probe = document.createElement('span')
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-family:var(--mono);font-size:12px'
    probe.textContent = '0'.repeat(100)
    document.body.appendChild(probe)
    const w = probe.offsetWidth / 100
    document.body.removeChild(probe)
    if (w > 0) charW.value = w
  }

  // Header label for a column (mirrors the template) so its width is counted too.
  // Overridable: each engine renders its headers differently, and a width measured
  // against the wrong text is a column that doesn't fit its own title.
  function headerLabel(col) {
    if (labelOf) return labelOf(col)
    if (col === '_id') return '{Document id}'
    return /^\d+$/.test(col) ? `[${col}]` : col
  }

  const colDefaultWidths = computed(() => {
    if (!cellData) return {}
    const cols = gridColumns()
    const rows = cellData()
    const out  = {}
    for (let c = 0; c < cols.length; c++) {
      let maxLen = headerLabel(cols[c]).length
      for (const row of rows) {
        const len = row[c].display.length
        if (len > maxLen) maxLen = len
      }
      out[cols[c]] = fitWidth(Math.ceil(maxLen * charW.value) + 24)
    }
    return out
  })

  // User resize / auto-fit wins; otherwise the content-derived default. Pinning the header
  // cell pins the whole column under auto table-layout.
  function thWidthStyle(col) {
    const w = colWidths.value[col] ?? colDefaultWidths.value[col]
    return w ? { minWidth: w + 'px', maxWidth: w + 'px' } : {}
  }

  if (cellData) onMounted(measureCharW)

  return { tableRef, colWidths, startResize, autoFitColumn, headerLabel, thWidthStyle }
}
