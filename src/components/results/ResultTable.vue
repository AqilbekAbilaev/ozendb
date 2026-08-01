<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick, markRaw } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { invoke } from '@tauri-apps/api/core'
import { errText } from '../../utils/errors'
import { valueToClipboard } from '../../utils/clipboardCopy'
import { dbRefOf, idFilterString } from '../../utils/dbRef'
import { guessType, TYPE_CLASS, formatCell, columns, getAtPath } from '../../utils/resultGrid'
import { useResultSearch } from '../../composables/useResultSearch'
import { useColumnReorder } from '../../composables/useColumnReorder'
import { useMomentumScroll } from '../../composables/useMomentumScroll'
import BaseIcon from '../base/BaseIcon.vue'
import BaseInput from '../base/BaseInput.vue'
import SearchBar from '../base/SearchBar.vue'

const props = defineProps({
  activeTab: { type: Object,  required: true },
  vqbOpen:   { type: Boolean, default: false },
  drillPath: { type: Array,   default: () => [] },  // field-name path navigated into
  // Read-only grid (e.g. IntelliShell results, which aren't a single editable
  // collection): disables inline cell editing. Drill-down still works.
  readonly:  { type: Boolean, default: false },
})

// The drag-to-VQB outputs (`vqb-drop`, `dragged-field`, `drag-over-section`) are
// consumed by VisualQueryBuilder, which lives beside this grid in ResultsPanel, so they
// bubble up rather than being held here. `update:drillPath` keeps drill state (owned by
// ResultsPanel so it survives view switches and the run-reset) in sync via v-model.
const emit = defineEmits(['dragged-field', 'drag-over-section', 'vqb-drop', 'open-vqb', 'close-vqb', 'crud-error', 'update:drillPath', 'follow-reference', 'paste-documents'])

function onThClick(col) {
  if (suppressNextClick) { suppressNextClick = false; return }
  if (!props.vqbOpen) return
  emit('dragged-field', col)
  nextTick(() => { emit('dragged-field', '') })
}

// ── drag a result cell → Visual Query Builder ──────────────
// HTML5 drag-and-drop doesn't fire drop events reliably inside Tauri's WKWebView,
// so dragging is done with raw mouse events. A drag only starts once the pointer
// moves past a small threshold, so a plain click still selects the cell. On drop
// we hit-test the pointer against the VQB sections (tagged with data-vqb-drop)
// and hand the field + section to VisualQueryBuilder via the vqbDrop prop.
const DRAG_THRESHOLD  = 5
const dragging        = ref(false)
const dragGhost       = ref({ x: 0, y: 0, label: '' })

let dragField         = ''
let dragValue         = ''
let dragStartX        = 0
let dragStartY        = 0
let suppressNextClick = false
let openedByDrag      = false  // did *this* drag auto-open the panel?

function sectionAtPoint(x, y) {
  const el = document.elementFromPoint(x, y)
  const zone = el && el.closest('[data-vqb-drop]')
  return zone ? zone.getAttribute('data-vqb-drop') : null
}

function onCellMouseDown(e, col, value) {
  if (e.button !== 0) return
  if (e.target.tagName === 'INPUT') return  // mousedown inside the active editor — leave it be
  // Commit any open inline edit before we handle this cell. The e.preventDefault()
  // below cancels the browser's focus shift (to stop the native drag-select gesture),
  // which would otherwise also suppress the editor input's blur — leaving it focused
  // and editable even after you click away to another cell.
  if (inlineEdit.value) commitInlineEdit()
  // Suppress the browser's native press-drag selection gesture, which otherwise
  // auto-scrolls the grid sideways as the pointer moves toward the VQB panel.
  // Click and dblclick still fire, so cell selection / editing is unaffected.
  e.preventDefault()
  suppressNextClick = false
  openedByDrag = false
  dragField  = col
  dragValue  = value == null ? '' : String(value)
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragging.value = false
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup',   onDragUp)
}

function onDragMove(e) {
  if (!dragging.value) {
    if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) < DRAG_THRESHOLD) return
    dragging.value = true
    document.body.style.cursor = 'grabbing'
    // Opening the panel mid-drag renders its drop zones (data-vqb-drop) just in
    // time for the pointer to reach them, so the drop hit-test below still works.
    if (!props.vqbOpen) { openedByDrag = true; emit('open-vqb') }
  }
  dragGhost.value = { x: e.clientX, y: e.clientY, label: dragField }
  emit('drag-over-section', sectionAtPoint(e.clientX, e.clientY))
}

function onDragUp(e) {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup',   onDragUp)
  document.body.style.cursor = ''
  if (dragging.value) {
    const section = sectionAtPoint(e.clientX, e.clientY)
    if (section) emit('vqb-drop', { field: dragField, value: dragValue, section: section, nonce: Date.now() })
    // Dropped outside the panel: if this drag is what opened it, close it again.
    else if (openedByDrag) emit('close-vqb')
    suppressNextClick = true  // swallow the click that fires after a real drag
  }
  dragging.value = false
  emit('drag-over-section', null)
  dragField = ''
  dragValue = ''
}

function onCellClick(e, rowIdx, col) {
  if (suppressNextClick) { suppressNextClick = false; return }
  // Shift / Ctrl+Cmd on a cell click select rows (document-level), not a single cell.
  if (e.shiftKey) { selectRangeTo(rowIdx); selectedCol.value = null; cellCtx.value = null; return }
  if (e.metaKey || e.ctrlKey) { toggleRow(rowIdx); selectedCol.value = null; cellCtx.value = null; return }
  selectCell(rowIdx, col)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup',   onDragUp)
})

// Filler rows pad the grid below real documents so the row stripes/borders
// reach the bottom of the viewport instead of stopping after a fixed count —
// recomputed from the actual container height so it still covers tall windows.
const gridWrapRef  = ref(null)
const FILLER_ROW_HEIGHT = 25
useMomentumScroll(gridWrapRef)   // touchpad swipes keep gliding after the fingers lift
const minFillRows  = ref(24)
let gridResizeObserver = null

function updateMinFillRows() {
  if (!gridWrapRef.value) return
  minFillRows.value = Math.max(24, Math.ceil(gridWrapRef.value.clientHeight / FILLER_ROW_HEIGHT))
}

watch(gridWrapRef, (el, prevEl) => {
  if (prevEl) gridResizeObserver?.unobserve(prevEl)
  if (el) {
    if (!gridResizeObserver) gridResizeObserver = new ResizeObserver(updateMinFillRows)
    gridResizeObserver.observe(el)
    updateMinFillRows()
  }
}, { flush: 'post' })

onUnmounted(() => { gridResizeObserver?.disconnect() })

function fillerCount(results) {
  return Math.max(0, minFillRows.value - (results?.length || 0))
}

// ── column resize ──────────────────────────────────────
const tableRef   = ref(null)
const colWidths  = ref({})   // col name → px; empty = auto layout

let resizeCol = null
let resizeStartX = 0
let resizeStartWidth = 0

function startResize(e, col) {
  e.preventDefault()
  e.stopPropagation()
  // Measure only the column being dragged so we never snap all columns at once
  const cols     = gridColumns.value
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

  const cols = gridColumns.value
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

// ── row / cell selection ──────────────────────────────
const selectedCol = ref(null)  // the field/cell selected in the grid
// Range anchor for Shift+click / Shift+Arrow multi-row selection. The active row is
// tab.selectedRow; the full set is tab.selectedRows. Anchor is where the current range
// started (a plain click / arrow move); it stays put while Shift extends the range.
const anchorRow = ref(-1)

// Is this grid row part of the current selection? Falls back to the single active row
// for tabs that predate selectedRows (defensive; new tabs seed it to []).
function isRowSelected(rowIdx) {
  const tab = props.activeTab
  if (!tab) return false
  const rows = tab.selectedRows
  return rows && rows.length ? rows.includes(rowIdx) : tab.selectedRow === rowIdx
}

// Collapse to a single selected row (or clear with -1). Resets the range anchor.
function setSingleRow(rowIdx) {
  const tab = props.activeTab
  tab.selectedRow = rowIdx
  tab.selectedRows = rowIdx < 0 ? [] : [rowIdx]
  anchorRow.value = rowIdx
}

// Select the contiguous range from the anchor to rowIdx (Shift gesture). The anchor is
// left untouched so successive Shift moves keep growing/shrinking from the same origin.
function selectRangeTo(rowIdx) {
  const tab = props.activeTab
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
  const tab = props.activeTab
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
watch(selectedCol, (col) => {
  if (props.activeTab) props.activeTab.selectedField = col || null
})
const cellCtx     = ref(null)  // { x, y, row, col } | null — right-click menu
const inlineEdit  = ref(null)  // { rowIdx, col, raw } | null — in-place primitive edit

const vFocus = { mounted(el) { el.focus(); el.select() } }

// Reset transient selection / widths when switching tabs so we re-measure on the new
// results. (Drill path is owned by ResultsPanel and reset there.)
watch(() => props.activeTab?.id, () => {
  selectedCol.value = null
  cellCtx.value = null
  colWidths.value = {}
  anchorRow.value = -1
})

// the "documents" the grid currently renders: either the real result set, or
// (once drilled) every document's value at the drilled path — one row per
// original document is kept, so documents missing that path just render blank
// instead of collapsing the grid down to a single row
// Cached once per render. The template reads these many times (the column list is
// referenced once per row), so computing them as plain functions made rendering a
// 200-document result O(rows²); memoizing keeps the draw fast.
const gridDocs = computed(() => {
  const tab = props.activeTab
  if (!tab) return []
  if (!props.drillPath.length) return tab.results || []
  return (tab.results || []).map((doc) => {
    const val = getAtPath(doc, props.drillPath) ?? {}
    if (Array.isArray(val)) {
      const obj = {}
      val.forEach((el, idx) => { obj[String(idx)] = el })
      return obj
    }
    return val
  })
})

// Column headers can be dragged to reorder; the chosen order is stored per drill path on the
// tab and applied over the derived column list. The gesture, drop indicator and edge
// auto-scroll all live in useColumnReorder — here we only supply the deps and read back the
// pieces the template binds. `reorderPressed` drives the grabbing cursor, `reorderDragging` the
// ghost, `dropIndicator` the insertion line, `reorderGhost` the floating label.
const derivedColumns = computed(() => columns(gridDocs.value))

const {
  gridColumns,
  onHeaderMouseDown,
  pressed:  reorderPressed,
  dragging: reorderDragging,
  dropIndicator,
  ghost:    reorderGhost,
} = useColumnReorder({
  activeTab:      () => props.activeTab,
  drillPath:      () => props.drillPath,
  derivedColumns: derivedColumns,
  tableRef:       tableRef,
  gridWrapRef:    gridWrapRef,
  headerLabel:    headerLabel,
  onBeforePress:  () => { if (inlineEdit.value) commitInlineEdit() },
  onReordered:    () => { suppressNextClick = true },
})

// ── per-cell display data (memoized) ────────────────────
// Derive each cell's formatted text, colour classes and drillability once per result
// set rather than inside the render function (which called guessType()/formatCell()
// several times per cell on every re-render). The template just reads these. Aligned
// to gridColumns: cellData[rowIndex] is the array of cells for that row.
const cellData = computed(() => {
  const cols = gridColumns.value
  return gridDocs.value.map((row) =>
    cols.map((col) => {
      const val = row[col]
      const type = guessType(col, val)
      return {
        col: col,
        display: formatCell(col, val),
        typeClass: 't-' + type,
        valClass: TYPE_CLASS[type],
        drillable: type === 'obj',
      }
    })
  )
})

// ── in-grid search (Ctrl/Cmd+F) ─────────────────────────
// Match-finding and the reactive highlight classes are grid-specific; the bar's
// open/index/debounce state lives in useResultSearch (shared with the JSON view).
function scrollToMatch() {
  const m = searchMatches.value[searchIdx.value]
  if (!m) return
  rowVirtualizer.value.scrollToIndex(m.row, { align: 'auto' })
  nextTick(() => {
    const td = tableRef.value?.querySelector(`td[data-match="${m.row},${m.col}"]`)
    if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}

const {
  open: searchOpen, count: searchTotal, index: searchIdx, query: searchQuery,
  setOpen, setQuery, next: searchNext, prev: searchPrev, close: searchClose,
} = useResultSearch({
  getMatches: () => searchMatches.value,
  onActivate: scrollToMatch,   // next/prev: scroll the active match into view
  onApply:    scrollToMatch,   // query settled: jump to the first match
  debounce:   150,
  resetOn:    () => props.activeTab?.results,
})

// Flat list of all matches: { row, col } for every cell whose display text contains
// the query (case-insensitive).
const searchMatches = computed(() => {
  const q = searchQuery.value.toLowerCase()
  if (!q) return []
  const docs  = gridDocs.value
  const cols  = gridColumns.value
  const cells = cellData.value
  const out   = []
  for (let r = 0; r < docs.length; r++) {
    const row = cells[r]
    if (!row) continue
    for (let c = 0; c < cols.length; c++) {
      if (row[c].display.toLowerCase().includes(q)) out.push({ row: r, col: cols[c] })
    }
  }
  return out
})

// Set of "row,col" strings for O(1) highlight lookups in the template.
const matchSet = computed(() => {
  const s = new Set()
  for (const m of searchMatches.value) s.add(m.row + ',' + m.col)
  return s
})

function isMatchCell(row, col) {
  return matchSet.value.has(row + ',' + col)
}

// ── column widths ───────────────────────────────────────
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
function headerLabel(col) {
  if (col === '_id') return '{Document id}'
  return /^\d+$/.test(col) ? `[${col}]` : col
}

const colDefaultWidths = computed(() => {
  const cols = gridColumns.value
  const rows = cellData.value
  const out  = {}
  for (let c = 0; c < cols.length; c++) {
    let maxLen = headerLabel(cols[c]).length
    for (const row of rows) {
      const len = row[c].display.length
      if (len > maxLen) maxLen = len
    }
    out[cols[c]] = Math.min(360, Math.max(40, Math.ceil(maxLen * charW.value) + 24))
  }
  return out
})

// User resize / auto-fit wins; otherwise the content-derived default. Pinning the header
// cell pins the whole column under auto table-layout.
function thWidthStyle(col) {
  const w = colWidths.value[col] ?? colDefaultWidths.value[col]
  return w ? { minWidth: w + 'px', maxWidth: w + 'px' } : {}
}

// ── row virtualization (@tanstack/vue-virtual) ──────────
// Only the rows in (and just beyond) the viewport are mounted; TanStack owns the scroll
// maths, overscan, viewport-resize handling and window updates. A 1000-row result mounts
// ~30 rows. `gridWrapRef` is the scroll container; `rowH` (measured from a real row) is
// the size estimate — rows are uniform (monospace, single line) so a fixed estimate is
// exact and no per-row measurement is needed.
const rowH = ref(FILLER_ROW_HEIGHT)
function measureRowH() {
  const tr = tableRef.value?.querySelector('tbody tr.datarow')
  if (!tr) return
  const h = tr.getBoundingClientRect().height
  if (h > 0 && Math.abs(h - rowH.value) > 0.25) rowH.value = h
}

const rowVirtualizer = useVirtualizer(computed(() => {
  const size = rowH.value  // read so the options object recomputes when it's measured
  return {
    count: cellData.value.length,
    getScrollElement: () => gridWrapRef.value,
    estimateSize: () => size,
    overscan: 12,
  }
}))

const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems())
const totalSize   = computed(() => rowVirtualizer.value.getTotalSize())
// Spacer heights that reserve the scroll extent of the un-mounted rows above / below.
const padTop    = computed(() => (virtualRows.value.length ? virtualRows.value[0].start : 0))
const padBottom = computed(() => {
  const rows = virtualRows.value
  return rows.length ? totalSize.value - rows[rows.length - 1].end : 0
})

// Return to the top when the underlying document set changes (new page, drill in/out,
// tab switch). An inline edit splices `results` in place — same array reference — so it
// deliberately does NOT reset the scroll. flush:'post' re-measures the row height once
// the fresh rows are on screen.
watch([() => props.activeTab?.id, () => props.activeTab?.results, () => props.drillPath],
  () => {
    if (gridWrapRef.value) gridWrapRef.value.scrollTop = 0
    nextTick(measureRowH)
    // The row set just changed (requery/drill/tab switch): drop any multi-row selection,
    // whose indices may no longer line up, collapsing back to the single active row so we
    // never carry stale indices into a copy/delete.
    const tab = props.activeTab
    if (tab) {
      tab.selectedRows = tab.selectedRow >= 0 ? [tab.selectedRow] : []
      anchorRow.value = tab.selectedRow ?? -1
    }
  }, { flush: 'post' })

function isDrillable(col, val) {
  return guessType(col, val) === 'obj'
}

function openCellDrill(rowIdx, col) {
  const tab = props.activeTab
  if (!tab) return
  const val = gridDocs.value[rowIdx]?.[col]
  if (!isDrillable(col, val)) return
  emit('update:drillPath', [...props.drillPath, col])
  selectedCol.value = null
  tab.selectedRow = -1
}

function goToDrillLevel(level) {
  emit('update:drillPath', level < 0 ? [] : props.drillPath.slice(0, level + 1))
  selectedCol.value = null
  if (props.activeTab) props.activeTab.selectedRow = -1
}

// Row-area click (row number / filler): apply the gesture, clear any cell selection.
function selectRow(e, rowIdx) {
  applyRowGesture(e, rowIdx)
  selectedCol.value = null
  cellCtx.value = null
}

// Single-row + single-cell selection (right-click, programmatic). No modifiers.
function selectCell(rowIdx, col) {
  setSingleRow(rowIdx)
  selectedCol.value = col
  cellCtx.value = null
}

// Shell-style serialization of a cell value for the clipboard. Shared with the Edit
// menu's Copy (see utils/clipboardCopy) so inline and menu copies stay identical.
function cellCopyValue(val) {
  return valueToClipboard(val)
}

function copySelectedCell() {
  const tab = props.activeTab
  if (!tab || tab.selectedRow < 0 || !selectedCol.value) return
  const val = gridDocs.value[tab.selectedRow]?.[selectedCol.value]
  navigator.clipboard.writeText(cellCopyValue(val))
}

function copySelectedDocument() {
  const tab = props.activeTab
  if (!tab || tab.selectedRow < 0) return
  navigator.clipboard.writeText(JSON.stringify(tab.results[tab.selectedRow], null, 2))
}

// Ctrl/Cmd+C: copy the selection. A single cell → that value; a single row → its
// document; multiple rows → a JSON array of the selected documents (in row order).
function copySelection() {
  const tab = props.activeTab
  if (!tab) return
  const rows = tab.selectedRows && tab.selectedRows.length
    ? tab.selectedRows
    : (tab.selectedRow >= 0 ? [tab.selectedRow] : [])
  if (!rows.length) return
  if (rows.length === 1) {
    selectedCol.value ? copySelectedCell() : copySelectedDocument()
    return
  }
  const docs = rows.map((i) => tab.results[i]).filter((d) => d != null)
  navigator.clipboard.writeText(JSON.stringify(docs, null, 2))
}

function openCellCtx(e, rowIdx, col) {
  e.preventDefault()
  selectCell(rowIdx, col)
  cellCtx.value = { x: e.clientX, y: e.clientY, row: rowIdx, col: col }
}

function cellCtxPick(action) {
  const docs = gridDocs.value
  const val = docs[cellCtx.value?.row]?.[cellCtx.value?.col]
  if (action === 'copy-value') {
    navigator.clipboard.writeText(cellCopyValue(val))
  } else if (action === 'copy-json') {
    navigator.clipboard.writeText(JSON.stringify(val, null, 2))
  } else if (action === 'copy-doc') {
    navigator.clipboard.writeText(JSON.stringify(docs[cellCtx.value.row], null, 2))
  }
  cellCtx.value = null
}

// The DBRef in the right-clicked cell, if any — drives the "Follow Reference" menu item.
const cellRef = computed(() => {
  if (!cellCtx.value) return null
  const val = gridDocs.value[cellCtx.value.row]?.[cellCtx.value.col]
  return dbRefOf(val)
})

// Open the referenced document: a new collection tab on the DBRef's collection (its own
// $db if given, else the current tab's database) filtered to `{ _id: <$id> }`.
function followReference() {
  const ref = cellRef.value
  const tab = props.activeTab
  if (!ref || !tab) { cellCtx.value = null; return }
  emit('follow-reference', {
    connectionId: tab.connectionId,
    connectionName: tab.connectionName,
    dbName: ref.db || tab.dbName,
    collectionName: ref.ref,
    filter: idFilterString(ref.id),
  })
  cellCtx.value = null
}

// ── inline cell editing ────────────────────────────────
function buildIdFilter(doc) {
  return JSON.stringify({ _id: doc._id })
}

function startInlineEdit(rowIdx, col) {
  if (props.readonly) return
  const tab = props.activeTab
  if (!tab) return
  const val = gridDocs.value[rowIdx]?.[col]
  const type = guessType(col, val)
  // Nested objects/arrays drill in; ObjectId (incl. _id) is not editable (replace_document
  // preserves _id, and editing a raw hex id is error-prone). Everything else — string,
  // number, boolean, date and Decimal128 — edits inline.
  if (type === 'obj' || type === 'id') return
  // formatCell unwraps Extended-JSON scalars ($date → ISO string, $numberDecimal → the
  // decimal string, $numberLong → the integer string) into their editable text form.
  const raw = formatCell(col, val)
  inlineEdit.value = { rowIdx: rowIdx, col: col, raw: raw }
}

async function commitInlineEdit() {
  const edit = inlineEdit.value
  if (!edit) return
  inlineEdit.value = null
  const tab = props.activeTab
  if (!tab) return
  const docs = gridDocs.value
  const originalVal = docs[edit.rowIdx]?.[edit.col]
  // Preserve the original BSON type on write-back, keyed off what the cell was. Date and
  // Decimal128 are re-wrapped as Extended JSON so the backend (which decodes the whole
  // document as bson::Bson) stores them as DateTime / Decimal128 again, not plain strings.
  // Invalid input (e.g. a non-ISO date) fails the backend's Extended-JSON parse and
  // surfaces as a crud error rather than silently corrupting the type.
  const type = guessType(edit.col, originalVal)
  let newVal
  if (type === 'num') {
    const n = Number(edit.raw)
    newVal = isNaN(n) ? edit.raw : n
  } else if (type === 'bool') {
    newVal = edit.raw === 'true'
  } else if (type === 'date') {
    newVal = { $date: edit.raw }
  } else if (type === 'decimal') {
    newVal = { $numberDecimal: edit.raw }
  } else {
    newVal = edit.raw
  }
  const rootDoc = JSON.parse(JSON.stringify(tab.results[edit.rowIdx]))
  let cur = rootDoc
  for (const key of props.drillPath) {
    cur = cur[key]
  }
  cur[edit.col] = newVal
  try {
    await invoke('replace_document', {
      id: tab.connectionId,
      database: tab.dbName,
      collection: tab.collectionName,
      idFilter: buildIdFilter(tab.results[edit.rowIdx]),
      document: JSON.stringify(rootDoc),
    })
    const refreshed = await invoke('find_documents', {
      id: tab.connectionId,
      database: tab.dbName,
      collection: tab.collectionName,
      filter: buildIdFilter(tab.results[edit.rowIdx]),
      projection: '{}',
      sort: '{}',
      skip: 0,
      limit: 1,
    })
    if (refreshed.length) {
      tab.results.splice(edit.rowIdx, 1, markRaw(refreshed[0]))
    } else {
      tab.results.splice(edit.rowIdx, 1)
    }
  } catch (e) {
    emit('crud-error', errText(e))
  }
}

function cancelInlineEdit() {
  inlineEdit.value = null
}

function handleKeydown(e) {
  // Don't hijack keys while the user is typing in a field (query bar, modals,
  // inline cell editor) — otherwise arrow keys / Ctrl+C drive grid navigation
  // instead of the input.
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (inlineEdit.value) return
  const tab = props.activeTab
  if (!tab) return

  if (e.key === 'Escape' && cellCtx.value) { cellCtx.value = null; return }

  const docs   = gridDocs.value

  // Ctrl/Cmd+A — select every fetched row. Works regardless of the current selection.
  if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
    if (!docs.length) return
    e.preventDefault()
    tab.selectedRows = docs.map((_, i) => i)
    tab.selectedRow = docs.length - 1
    anchorRow.value = 0
    selectedCol.value = null
    return
  }

  // Ctrl/Cmd+V — insert the clipboard's document(s) into this collection. The counterpart
  // to Ctrl+C below; no row selection needed, so it sits above the selection guard.
  if ((e.metaKey || e.ctrlKey) && (e.key === 'v' || e.key === 'V')) {
    e.preventDefault()
    emit('paste-documents')
    return
  }

  if (tab.selectedRow < 0) return

  const cols   = gridColumns.value
  const colIdx = cols.indexOf(selectedCol.value)
  const rowIdx = tab.selectedRow

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
    rowVirtualizer.value.scrollToIndex(tab.selectedRow, { align: 'auto' })
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
  } else if (e.key === 'ArrowDown' && rowIdx < docs.length - 1) {
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

onMounted(()  => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))

// One-time monospace char-width measurement (feeds column sizing), plus an initial
// row-height measure once the first rows have rendered (feeds the virtualizer estimate).
onMounted(() => { measureCharW(); nextTick(measureRowH) })

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
</script>

<template>
  <div class="grid-outer">
    <!-- In-grid search bar (Ctrl/Cmd+F) -->
    <SearchBar
      :open="searchOpen"
      :count="searchTotal"
      :current="searchIdx"
      @update:open="setOpen"
      @update:query="setQuery"
      @next="searchNext"
      @prev="searchPrev"
      @close="searchClose"
    />

    <div class="fieldpath">
      <span class="fp fp-link" @click="goToDrillLevel(-1)">{{ activeTab.collectionName }}</span>
      <template v-for="(seg, idx) in drillPath" :key="idx">
        <BaseIcon name="caret" :size="11" class="fp-sep" />
        <span class="fp fp-link" @click="goToDrillLevel(idx)">{{ seg }}</span>
      </template>
      <template v-if="selectedCol">
        <BaseIcon name="caret" :size="11" class="fp-sep" />
        <span class="fp">{{ selectedCol }}</span>
      </template>
    </div>
    <div class="grid-wrap" ref="gridWrapRef">
    <div class="grid-scroll">
    <template v-if="!activeTab.hasRun || activeTab.isRunning">
      <table class="grid">
        <thead><tr>
          <th class="rownum"></th>
          <th style="min-width:320px;max-width:320px">{Document id}</th>
          <th class="col-filler"></th>
        </tr></thead>
      </table>
      <div class="empty-rows"><div class="empty-rows-gutter"></div></div>
    </template>
    <template v-else-if="activeTab.results?.length === 0">
      <table class="grid">
        <thead><tr>
          <th class="rownum"></th>
          <th style="min-width:320px;max-width:320px">{Document id}</th>
          <th class="col-filler"></th>
        </tr></thead>
      </table>
      <div class="empty-rows"><div class="empty-rows-gutter"></div></div>
    </template>
    <template v-else>
      <table
        class="grid"
        :class="{ reordering: reorderPressed }"
        ref="tableRef"
      >
        <thead>
          <tr>
            <th class="rownum"></th>
            <th
              v-for="col in gridColumns"
              :key="col"
              :data-col="col"
              :style="thWidthStyle(col)"
              @click.stop="onThClick(col)"
              @mousedown="onHeaderMouseDown($event, col)"
            >
              {{ col === '_id' ? '{Document id}' : (/^\d+$/.test(col) ? `[${col}]` : col) }}
              <div class="col-resize-handle" draggable="false" @dragstart.prevent @mousedown="startResize($event, col)" @dblclick.stop="autoFitColumn($event, col)"></div>
            </th>
            <th class="col-filler"></th>
          </tr>
        </thead>
        <tbody>
          <!-- Spacer reserving the height of the rows above the window (see rowVirtualizer). -->
          <tr v-if="padTop > 0" class="vspacer" aria-hidden="true">
            <td :colspan="gridColumns.length + 2" :style="{ height: padTop + 'px' }"></td>
          </tr>
          <tr
            v-for="vrow in virtualRows"
            :key="vrow.index"
            class="datarow"
            :class="{ selrow: isRowSelected(vrow.index), stripe: vrow.index % 2 === 1 }"
            @click="selectRow($event, vrow.index)"
          >
            <td class="rownum">{{ vrow.index + 1 }}</td>
            <td
              v-for="cell in cellData[vrow.index]"
              :key="cell.col"
              :data-match="searchOpen && isMatchCell(vrow.index, cell.col) ? vrow.index + ',' + cell.col : undefined"
              :class="{ selcell: activeTab.selectedRow === vrow.index && selectedCol === cell.col, drillable: cell.drillable, 'search-match': isMatchCell(vrow.index, cell.col), 'search-active': searchOpen && searchMatches[searchIdx]?.row === vrow.index && searchMatches[searchIdx]?.col === cell.col }"
              @mousedown="onCellMouseDown($event, cell.col, cell.display)"
              @click.stop="onCellClick($event, vrow.index, cell.col)"
              @dblclick.stop="cell.drillable ? openCellDrill(vrow.index, cell.col) : startInlineEdit(vrow.index, cell.col)"
              @contextmenu="openCellCtx($event, vrow.index, cell.col)"
            >
              <template v-if="inlineEdit && inlineEdit.rowIdx === vrow.index && inlineEdit.col === cell.col">
                <BaseInput
                  class="cell-edit-input"
                  v-model="inlineEdit.raw"
                  v-focus
                  @keydown.enter.stop="commitInlineEdit"
                  @keydown.escape.stop="cancelInlineEdit"
                  @blur="commitInlineEdit"
                />
              </template>
              <span v-else class="tcell" :class="cell.typeClass">
                <span class="tval" :class="cell.valClass">
                  {{ cell.display }}
                </span>
              </span>
            </td>
            <td class="col-filler"></td>
          </tr>
          <!-- Spacer reserving the height of the rows below the window. -->
          <tr v-if="padBottom > 0" class="vspacer" aria-hidden="true">
            <td :colspan="gridColumns.length + 2" :style="{ height: padBottom + 'px' }"></td>
          </tr>
          <tr
            v-for="f in fillerCount(gridDocs)"
            :key="'f' + f"
            class="filler"
          >
            <td class="rownum"></td>
            <td v-for="col in gridColumns" :key="col"></td>
            <td class="col-filler"></td>
          </tr>
        </tbody>
      </table>
    </template>
    </div>
    </div>
  </div>

  <!-- Cell right-click context menu -->
  <template v-if="cellCtx">
    <div class="cell-ctx-backdrop" @mousedown="cellCtx = null"></div>
    <div class="cell-ctx-menu" :style="{ left: cellCtx.x + 'px', top: cellCtx.y + 'px' }">
      <template v-if="cellRef">
        <div class="cell-ctx-item" @click="followReference()">
          <span class="cell-ctx-ic"><BaseIcon name="aggregate" :size="14" /></span>
          Follow Reference → {{ cellRef.ref }}
        </div>
        <div class="cell-ctx-sep"></div>
      </template>
      <div class="cell-ctx-item" @click="cellCtxPick('copy-value')">
        <span class="cell-ctx-ic"><BaseIcon name="copy" :size="14" /></span>
        Copy Value
        <span class="cell-ctx-sc">⌘C</span>
      </div>
      <div class="cell-ctx-item" @click="cellCtxPick('copy-json')">
        <span class="cell-ctx-ic"></span>
        Copy as JSON
      </div>
      <div class="cell-ctx-sep"></div>
      <div class="cell-ctx-item" @click="cellCtxPick('copy-doc')">
        <span class="cell-ctx-ic"></span>
        Copy Document
      </div>
    </div>
  </template>

  <!-- Floating label that follows the pointer while dragging a cell into the VQB -->
  <div
    v-if="dragging"
    class="drag-ghost"
    :style="{ left: dragGhost.x + 14 + 'px', top: dragGhost.y + 14 + 'px' }"
  >{{ dragGhost.label }}</div>

  <!-- Drag-ghost for column reorder (reuses the same ghost class + CSS) -->
  <div
    v-if="reorderDragging"
    class="drag-ghost"
    :style="{ left: reorderGhost.x + 14 + 'px', top: reorderGhost.y + 14 + 'px' }"
  >{{ reorderGhost.label }}</div>

  <!-- Drop-insertion line for column reorder -->
  <div
    v-if="dropIndicator"
    class="drop-indicator"
    :style="{ left: dropIndicator.left + 'px', top: dropIndicator.top + 'px', height: dropIndicator.height + 'px' }"
  ></div>
</template>

<style scoped>
/* Grid */
.grid-outer { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--bg-window); position: relative; }
.grid-wrap { flex: 1; overflow: auto; min-height: 0; }
.grid-scroll { width: max-content; min-width: 100%; }
.fieldpath {
  height: 34px;
  flex: none;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  background: var(--bg-panel-2);
  border-bottom: 1px solid var(--border);
}
.fieldpath .fp-sep { color: var(--text-faint); }
.fieldpath .fp-link { cursor: pointer; }
.fieldpath .fp-link:hover { color: var(--accent); }
table.grid {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
  font-family: var(--mono);
  font-size: 12px;
}
table.grid th {
  position: sticky;
  top: 0;
  background: var(--bg-toolbar);
  color: var(--text-dim);
  font-weight: 600;
  text-align: left;
  padding: 5px 12px;
  border-right: 1px solid var(--grid-line);
  border-bottom: 1px solid var(--border-soft);
  white-space: nowrap;
  z-index: 2;
}
table.grid td {
  padding: 4px 12px;
  border-right: 1px solid var(--grid-line);
  border-bottom: 1px solid var(--grid-line);
  color: var(--text);
  white-space: nowrap;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Zebra striping keyed off the real row index (vrow.index), not DOM position — the
   virtualization spacer rows would otherwise flip the nth-child parity as you scroll. */
table.grid tr.datarow.stripe td { background: var(--bg-row-alt); }
table.grid tr:hover td { background: var(--bg-hover); }
/* Selection — accent-blue tint. The .datarow.selrow specificity intentionally beats the
   striped-row and hover rules so a selected row reads clearly whether it's striped or
   hovered (the old single-class .selrow lost to .datarow.stripe on odd rows). */
table.grid tr.datarow.selrow td { background: var(--bg-selected); }
table.grid td.selcell { outline: 2px solid var(--accent); outline-offset: -2px; position: relative; z-index: 4; }
table.grid td.drillable { cursor: pointer; }
/* rownum — sticky left gutter column */
table.grid th.rownum,
table.grid td.rownum {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--bg-panel-2);
  color: var(--text-faint);
  text-align: right;
  min-width: 46px;
  border-right: 1px solid var(--border-soft);
}
table.grid th.rownum { z-index: 3; }
table.grid tr:hover td.rownum { background: var(--bg-hover); }
/* Selected rows get an accent bar down the sticky row-number gutter — a clear, contiguous
   marker for a multi-row selection. Higher specificity than the hover rule above. */
table.grid tr.datarow.selrow td.rownum {
  background: var(--bg-selected);
  color: var(--accent);
  box-shadow: inset 3px 0 0 var(--accent);
}
/* virtualization spacers — reserve scroll height for the un-mounted rows above/below
   the window; they carry no border or fill so they read as empty gap, not a row. */
table.grid tr.vspacer td { padding: 0; border: none; background: transparent; }
/* filler rows extend the column grid below real documents */
table.grid tr.filler td { height: 25px; padding: 0; }
table.grid tr.filler:nth-child(even) td { background: var(--bg-row-alt); }
th.col-filler, td.col-filler { border-right: none; width: 100%; }

/* Drag ghost — follows the pointer while dragging a cell into the VQB.
   pointer-events:none is required so elementFromPoint sees the dropzone, not the ghost. */
.drag-ghost {
  position: fixed;
  z-index: 200;
  pointer-events: none;
  background: var(--accent);
  color: #fff;
  font-family: var(--mono);
  font-size: 12px;
  padding: 4px 9px;
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, .45);
  white-space: nowrap;
}

/* Cell context menu */
.cell-ctx-backdrop { position: fixed; inset: 0; z-index: 80; }
.cell-ctx-menu {
  position: fixed;
  z-index: 81;
  min-width: 190px;
  background: var(--bg-menu);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 18px 48px rgba(0,0,0,.6);
  padding: 5px;
}
.cell-ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 8px;
  border-radius: 5px;
  font-size: 13px;
  color: var(--text);
  cursor: default;
}
.cell-ctx-item:hover { background: var(--accent); color: #fff; }
.cell-ctx-ic { width: 18px; flex: none; display: grid; place-items: center; color: var(--text-dim); }
.cell-ctx-item:hover .cell-ctx-ic,
.cell-ctx-item:hover .cell-ctx-sc { color: rgba(255,255,255,.75); }
.cell-ctx-sc { margin-left: auto; color: var(--text-faint); font-size: 12px; letter-spacing: .5px; }
.cell-ctx-sep { height: 1px; background: var(--border-soft); margin: 5px 8px; }

.col-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 12px;
  height: 100%;
  cursor: col-resize;
  z-index: 1;
  transform: translateX(50%);
}

.tcell { display: inline-flex; align-items: center; gap: 6px; vertical-align: middle; }
.cell-oid   { color: var(--link); }
.cell-str   { color: var(--cell-str-green); }
.cell-num   { color: var(--cell-num); }
.cell-faint { color: var(--text-faint); }

.empty-rows {
  min-height: 2000px;
  position: relative;
  background:
    repeating-linear-gradient(to bottom, transparent 0 24px, var(--grid-line) 24px 25px),
    repeating-linear-gradient(to bottom, var(--bg-row) 0 25px, var(--bg-row-alt) 25px 50px);
}
.empty-rows-gutter {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 46px;
  /* Alternate per 25px row like the populated grid's row-number gutter, so the empty
     state doesn't read as one solid near-black bar. */
  background: repeating-linear-gradient(
    to bottom,
    var(--bg-panel-2) 0 25px,
    var(--bg-row-alt) 25px 50px
  );
  border-right: 1px solid var(--border-soft);
}

/* Data-column headers are draggable to reorder (row-number + filler headers are not; the
   resize handle overrides its own right-edge cursor). */
table.grid thead th:not(.rownum):not(.col-filler) { cursor: grab; }
/* While a header is pressed (mousedown through release) show the closed hand across every
   header, so the drag reads as grabbing the whole time — not just once it starts moving. The
   second rule covers the resize handle that straddles each column border, which would
   otherwise flip the cursor to col-resize as the pointer crosses a boundary mid-drag. */
table.grid.reordering thead th:not(.rownum):not(.col-filler) { cursor: grabbing; }
table.grid.reordering .col-resize-handle { cursor: grabbing; }

/* Drop-indicator line for column reorder */
.drop-indicator {
  position: fixed;
  z-index: 10;
  width: 2px;
  background: var(--accent);
  pointer-events: none;
}

/* Inline cell editor */
.base-input.cell-edit-input {
  background: transparent;
  border: none;
  font-family: var(--mono);
  font-size: 12px;
  padding: 0;
}

/* Search match highlighting */
td.search-match { background: var(--search-hit) !important; }
td.search-active { background: var(--search-active) !important; }
</style>
