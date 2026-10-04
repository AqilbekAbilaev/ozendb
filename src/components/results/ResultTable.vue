<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { vqbOpen } from '../../stores/visualQueryBuilder'
import { guessType, TYPE_CLASS, formatCell, columns, getAtPath } from '../../utils/resultGrid'
import { useResultSearch } from '../../composables/useResultSearch'
import { useColumnReorder, useDrillColumnOrder } from '../../composables/useColumnReorder'
import { useColumnResize } from '../../composables/useColumnResize'
import { useRowSelection } from '../../composables/useRowSelection'
import { useFieldDrag } from '../../composables/useFieldDrag'
import { useMomentumScroll } from '../../composables/useMomentumScroll'
import { useGridCells } from '../../composables/useGridCells'
import { useMongoCellActions } from '../../composables/useMongoCellActions'
import { useResultKeyboard } from '../../composables/useResultKeyboard'
import { useRowVirtualizer } from '../../composables/useRowVirtualizer'
import BaseIcon from '../base/BaseIcon.vue'
import BaseInput from '../base/BaseInput.vue'
import ContextMenu from '../base/ContextMenu.vue'
import SearchBar from '../base/SearchBar.vue'

const props = defineProps({
  activeTab: { type: Object,  required: true },
  drillPath: { type: Array,   default: () => [] },  // field-name path navigated into
  // Read-only grid (IntelliShell, Current Operations): no inline cell editing; drill-down still works.
  readonly:  { type: Boolean, default: false },
  rowClass:  { type: Function, default: null },  // extra per-row class, by row index
  holder:      { type: Object, default: null },  // results + selection (a MongoDB tab's runtime); else the tab
  orderHolder: { type: Object, default: null },  // column order (a MongoDB tab's query state); else the tab
})
const held = () => props.holder ?? props.activeTab

// The drag-to-VQB outputs (`vqb-drop`, `dragged-field`, `drag-over-section`) are
// consumed by VisualQueryBuilder, which lives beside this grid in ResultsPanel, so they
// bubble up rather than being held here. `update:drillPath` keeps drill state (owned by
// ResultsPanel so it survives view switches and the run-reset) in sync via v-model.
const emit = defineEmits(['dragged-field', 'drag-over-section', 'vqb-drop', 'crud-error', 'update:drillPath', 'follow-reference', 'paste-documents'])

function onThClick(col) {
  if (suppressNextClick.value) { suppressNextClick.value = false; return }
  if (!vqbOpen.value) return
  emit('dragged-field', col)
  nextTick(() => { emit('dragged-field', '') })
}

// Dragging a cell into the Visual Query Builder. The gesture itself lives in the
// composable; what a mousedown means for editing and selection stays here.
const { dragging, dragGhost, suppressNextClick, beginDrag } = useFieldDrag({ emit: emit })

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
  beginDrag(e, col, value)
}

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

// Column widths: user resize / auto-fit plus the content-derived defaults, and the
// header label the widths are measured from. gridColumns and cellData are passed as
// getters because neither is built until further down (see the composable).
const {
  tableRef, colWidths, startResize, autoFitColumn, headerLabel, thWidthStyle,
} = useColumnResize({
  gridColumns: () => gridColumns.value,
  cellData:    () => cellData.value,
})

// ── row / cell selection ──────────────────────────────
const rowSelection = useRowSelection({ activeTab: held })
const { selectedCol, anchorRow, isRowSelected } = rowSelection

const cells = useGridCells({ rows: rowSelection, suppressNextClick })
const { cellCtx, onCellClick, selectRow, openCellCtx } = cells

const {
  inlineEdit, cellMenuItems, copySelection, cellCtxPick,
  startInlineEdit, commitInlineEdit, cancelInlineEdit, openCellDrill, goToDrillLevel,
} = useMongoCellActions({
  activeTab:  () => props.activeTab,
  holder:     held,
  drillPath:  () => props.drillPath,
  readonly:   () => props.readonly,
  gridDocs:   () => gridDocs.value,
  selectedCol: selectedCol,
  cells:      cells,
  emit:       emit,
})

const vFocus = { mounted(el) { el.focus(); el.select() } }

// Reset transient selection / widths when switching tabs so we re-measure on the new
// results. (Drill path is owned by ResultsPanel and reset there.)
watch(() => props.activeTab?.id, () => {
  selectedCol.value = null
  cellCtx.value = null
  colWidths.value = {}
  anchorRow.value = -1
})

// The rows the grid renders: the results, or once drilled each document's value at the
// path (one row per document, so a missing path renders blank rather than vanishing).
// Memoized: the template reads it per row, and recomputing made 200 rows O(rows²).
const gridDocs = computed(() => {
  const results = held()?.results
  if (!results) return []
  if (!props.drillPath.length) return results
  return results.map((doc) => {
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

const { gridColumns, moveColumn } = useDrillColumnOrder({
  activeTab: () => props.orderHolder ?? props.activeTab, drillPath: () => props.drillPath, derivedColumns,
})
const {
  onHeaderMouseDown,
  pressed:  reorderPressed,
  dragging: reorderDragging,
  dropIndicator,
  ghost:    reorderGhost,
} = useColumnReorder({
  columns:        () => gridColumns.value,
  moveColumn,     tableRef,
  gridWrapRef:    gridWrapRef,
  headerLabel:    headerLabel,
  onBeforePress:  () => { if (inlineEdit.value) commitInlineEdit() },
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
  scrollToRow(m.row)
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
  resetOn:    () => held()?.results,
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

// ── row virtualization ─────────────────────────────────
// The wiring lives in useRowVirtualizer, shared with the PostgreSQL grid; what stays
// here is what this grid measures it against.
const { virtualRows, padTop, padBottom, remeasure, scrollToRow } = useRowVirtualizer({
  count: () => cellData.value.length,
  scrollElement: () => gridWrapRef.value,
  rowElement: () => tableRef.value?.querySelector('tbody tr.datarow'),
  estimate: FILLER_ROW_HEIGHT,
})

useResultKeyboard({
  selection: held, rows: rowSelection, cellCtx, copySelection, tableRef, gridWrapRef,
  rowCount: () => gridDocs.value.length, columns: () => gridColumns.value, editing: () => !!inlineEdit.value,
  onPaste: () => emit('paste-documents'), scrollToRow: scrollToRow,
})
onMounted(remeasure)

// Return to the top when the underlying document set changes (new page, drill in/out,
// tab switch). An inline edit splices `results` in place — same array reference — so it
// deliberately does NOT reset the scroll. flush:'post' re-measures the row height once
// the fresh rows are on screen.
watch([() => props.activeTab?.id, () => held()?.results, () => props.drillPath],
  () => {
    if (gridWrapRef.value) gridWrapRef.value.scrollTop = 0
    remeasure()
    // The row set just changed: collapse to the single active row, so stale multi-row
    // indices never reach a copy/delete.
    const selection = held()
    if (!selection) return
    selection.selectedRows = selection.selectedRow >= 0 ? [selection.selectedRow] : []
    anchorRow.value = selection.selectedRow ?? -1
  }, { flush: 'post' })

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
    <template v-if="!held().hasRun || held().isRunning">
      <table class="grid">
        <thead><tr>
          <th class="rownum"></th>
          <th style="min-width:320px;max-width:320px">{Document id}</th>
          <th class="col-filler"></th>
        </tr></thead>
      </table>
      <div class="empty-rows"><div class="empty-rows-gutter"></div></div>
    </template>
    <template v-else-if="held().results?.length === 0">
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
            :class="[{ selrow: isRowSelected(vrow.index), stripe: vrow.index % 2 === 1 }, rowClass && rowClass(vrow.index)]"
            @click="selectRow($event, vrow.index)"
          >
            <td class="rownum">{{ vrow.index + 1 }}</td>
            <td
              v-for="cell in cellData[vrow.index]"
              :key="cell.col"
              :data-match="searchOpen && isMatchCell(vrow.index, cell.col) ? vrow.index + ',' + cell.col : undefined"
              :class="{ selcell: held().selectedRow === vrow.index && selectedCol === cell.col, drillable: cell.drillable, 'search-match': isMatchCell(vrow.index, cell.col), 'search-active': searchOpen && searchMatches[searchIdx]?.row === vrow.index && searchMatches[searchIdx]?.col === cell.col }"
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

  <ContextMenu
    v-if="cellCtx"
    :menu="{ x: cellCtx.x, y: cellCtx.y, items: cellMenuItems }"
    @pick="cellCtxPick"
    @close="cellCtx = null"
  />

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

<style src="./ResultTable.css" scoped></style>
