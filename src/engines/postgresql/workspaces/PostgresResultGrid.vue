<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import ContextMenu from '../../../components/base/ContextMenu.vue'
import { formatCell, cellKind } from './formatCell.js'
import { valueText, rowsAsTsv, rowsAsJson } from './copyText.js'
import { useColumnResize } from '../../../composables/useColumnResize'
import { useColumnReorder } from '../../../composables/useColumnReorder'
import { useRowSelection } from '../../../composables/useRowSelection'
import { useGridCells } from '../../../composables/useGridCells'
import { useResultKeyboard } from '../../../composables/useResultKeyboard'
import { useRowVirtualizer } from '../../../composables/useRowVirtualizer'

// Rows arrive as arrays aligned to `columns` — keys, which `columnInfo` names (with
// their table, when the tab joins others) — so a repeated column name stays its own
// column. Sorting and editing are opt-in: the query tab shows results read-only, and
// without `columnInfo` (types, primary keys), since a query's columns aren't a table's.
// `selection` is kept by whatever holds the rows (createSelection), which starts a fresh
// one with each new result.
const props = defineProps({
  columns:    { type: Array,    required: true },
  rows:       { type: Array,    required: true },
  selection:  { type: Object,   required: true },
  columnInfo: { type: Object,   default: () => ({}) },
  rowOffset:  { type: Number,   default: 0 },
  // Overrides rowOffset's numbering, for a grid that mixes in rows not yet saved.
  rowLabel:   { type: Function, default: null },
  orderBy:    { type: String,   default: null },
  descending: { type: Boolean,  default: false },
  sortable:   { type: Boolean,  default: false },
  // Headers drag to reorder, reported as `move-column`; the table tab keeps the order.
  reorderable: { type: Boolean, default: false },
  // The table tab's per-column filter boxes; typing reports the text, Enter applies.
  filterText: { type: Object,   default: null },
  canEdit:    { type: Function, default: () => false },
  editText:   { type: Function, default: (column, value) => (value === null ? '' : formatCell(value)) },
  // 'deleted' | 'inserted' | null for a grid row index — staged, unsaved state the row
  // is styled for (strikethrough / a positive tint). Absent means an ordinary loaded row.
  rowStatus:  { type: Function, default: () => null },
})
const emit = defineEmits(['sort', 'save', 'filter-text', 'apply-filters', 'move-column'])

const PLACEHOLDERS = { num: 'e.g. >100', date: 'e.g. 2026-09', bool: 'true / false', enum: 'e.g. a, b' }

const filtering = computed(() => Object.values(props.filterText ?? {}).some(text => text?.trim()))
const kinds = computed(() => props.columns.map(c => cellKind(props.columnInfo[c]?.dataType, props.columnInfo[c]?.enumValues)))

// Virtualized rows mount as you scroll, so auto table-layout would resize the columns
// under the pointer. The widths are pinned from the content instead, sampled from the
// first rows rather than all of them: a page can be 10,000 rows, and the widest value
// in the first few hundred is a good enough column width. The estimate assumes the
// monospace grid font, so a proportional text column comes out a little wide — steady
// and slightly roomy beats exact and jittering.
const WIDTH_SAMPLE = 200
const cellData = computed(() =>
  props.rows.slice(0, WIDTH_SAMPLE).map(row => row.map(value => ({ display: formatCell(value) }))))

// A header here is three lines deep: the name (with its table's prefix when the tab
// joins others), the type under it, and the filter box under that. The width estimate
// measures one string, so it gets whichever of the first two is longer — comparing
// character counts across two font sizes is rough, but erring wide is harmless here
// and erring narrow clips the type.
function headerText(column) {
  const info = props.columnInfo[column]
  const name = (info?.tableLabel ? info.tableLabel + '.' : '') + (info?.name ?? column)
  const type = info?.dataType ?? ''
  return name.length >= type.length ? name : type
}

// The filter box's own min-width (92px) plus the cell's padding: with filters showing,
// no column can usefully be narrower than its own input.
const FILTER_MIN_WIDTH = 116

const { tableRef, startResize, autoFitColumn, thWidthStyle } = useColumnResize({
  gridColumns: () => props.columns,
  cellData: () => cellData.value,
  headerLabel: headerText,
  minWidth: () => (props.filterText ? FILTER_MIN_WIDTH : 0),
})

const rowSelection = useRowSelection({ activeTab: () => props.selection })
const { selectedCol, anchorRow, isRowSelected } = rowSelection
const { cellCtx, onCellClick, selectRow, selectCell, openCellCtx } = useGridCells({ rows: rowSelection })

// Mounting again, or being handed another tab's selection, picks up where it was left.
watch(() => props.selection, (held) => {
  selectedCol.value = held.selectedField
  anchorRow.value = held.selectedRow
}, { immediate: true })

const isSelectedCell = (r, column) => selectedCol.value === column && props.selection.selectedRow === r
const valueAt = (r, column) => props.rows[r]?.[props.columns.indexOf(column)]
const copy = (text) => navigator.clipboard.writeText(text)

// Cmd/Ctrl+C: the selected cell's value, or the selected rows when there's no one cell.
function copySelection() {
  const { selectedRow, selectedRows } = props.selection
  const indexes = selectedRows.length ? selectedRows : [selectedRow]
  if (indexes.length === 1 && selectedCol.value) copy(valueText(valueAt(selectedRow, selectedCol.value)))
  else copy(rowsAsTsv(indexes.map(r => props.rows[r])))
}

const CELL_MENU = [
  { label: 'Copy Value', value: 'value', icon: 'copy', shortcut: '⌘C' },
  { sep: true },
  { label: 'Copy Row', value: 'row' },
  { label: 'Copy Row as JSON', value: 'json' },
]

function cellCtxPick(action) {
  const { row, col } = cellCtx.value
  if (action === 'value') copy(valueText(valueAt(row, col)))
  else if (action === 'row') copy(rowsAsTsv([props.rows[row]]))
  else if (action === 'json') copy(rowsAsJson(props.columns, [props.rows[row]]))
  cellCtx.value = null
}

const gridWrapRef = ref(null)

const { onHeaderMouseDown, pressed, dragging: reordering, dropIndicator, ghost } = useColumnReorder({
  columns: () => props.columns,
  moveColumn: (column, insertBefore) => emit('move-column', column, insertBefore),
  tableRef, gridWrapRef,
  headerLabel: (column) => props.columnInfo[column]?.name ?? column,
  onBeforePress: commit,
})

// Only the rows near the viewport are mounted: a 10,000-row result renders about
// thirty. Shared with MongoDB's grid (see useRowVirtualizer).
const { virtualRows, padTop, padBottom, remeasure, scrollToRow } = useRowVirtualizer({
  count: () => props.rows.length,
  scrollElement: () => gridWrapRef.value,
  rowElement: () => tableRef.value?.querySelector('tbody tr.datarow'),
  estimate: 28,
})

// A new result is a new set of rows: back to the top, and re-measure, since a result
// whose columns show enum pills has taller rows than one that doesn't.
watch(() => props.rows, () => {
  if (gridWrapRef.value) gridWrapRef.value.scrollTop = 0
  remeasure()
})
onMounted(remeasure)

useResultKeyboard({
  selection: () => props.selection, rows: rowSelection, cellCtx, copySelection, tableRef, gridWrapRef,
  rowCount: () => props.rows.length, columns: () => props.columns, editing: () => !!editing.value,
  scrollToRow: scrollToRow,
})

const editing = ref(null)   // { row, column, text, seed }
const input = ref(null)

async function startEdit(rowIndex, column, value) {
  if (!props.canEdit(column, rowIndex)) return
  const seed = props.editText(column, value)
  editing.value = { row: rowIndex, column, text: seed, seed }
  await nextTick()
  input.value?.[0]?.focus()
}

// Enter and leaving the cell both save; Escape clears `editing` first, so the blur
// that follows its removal finds nothing to save. An unchanged value isn't saved.
function commit() {
  if (!editing.value) return
  const { row, column, text, seed } = editing.value
  editing.value = null
  if (text !== seed) emit('save', row, column, text)
}

// Saves a real NULL — not the empty text or the word "NULL" typed into the box.
function setNull() {
  const { row, column } = editing.value
  editing.value = null
  emit('save', row, column, null)
}

// A new row can land past the viewport with nothing to draw attention to it — scroll it
// into view and select it, opening its first editable cell unless `edit` is false (a
// duplicate already has values). Two ticks: scrollToRow's scroll event re-renders
// virtualRows asynchronously, so the target row isn't mounted yet on the first one.
async function focusNewRow(rowIndex, { edit = true } = {}) {
  // 'center', not 'end': the row height used for this scroll is still the last
  // measurement (remeasure() hasn't run for it yet), so an 'end' alignment flush
  // against the viewport's bottom edge has no margin for that estimate being off —
  // a few px under and the row lands clipped behind the footer. Centering leaves
  // slack on both sides. 'auto' (the keyboard-nav default) is worse still — it stops
  // at the first sliver of visibility.
  scrollToRow(rowIndex, 'center')
  await nextTick()
  await nextTick()
  const column = edit && props.columns.find(c => props.canEdit(c, rowIndex))
  if (column) {
    selectCell(rowIndex, column)
    startEdit(rowIndex, column, null)
  } else {
    rowSelection.setSingleRow(rowIndex)
  }
}
// The row a duplicate was copied from, highlighted for a moment so the copy right below
// it reads as its (#170); cleared when the fade ends.
const flashedRow = ref(-1)
async function flashRow(rowIndex) {
  // Off first, so flashing the same row again restarts the fade.
  flashedRow.value = -1
  await nextTick()
  flashedRow.value = rowIndex
}
defineExpose({ focusNewRow, flashRow })
</script>

<template>
  <div ref="gridWrapRef" class="pg-grid">
    <table ref="tableRef" :class="{ pressed }">
      <thead>
        <tr>
          <th class="rownum">
            <BaseIcon v-if="filterText" name="filter" :size="12" class="funnel" :class="{ on: filtering }" />
          </th>
          <th
            v-for="(column, c) in columns"
            :key="c"
            :class="{ sortable }"
            :style="thWidthStyle(column)"
            @click="sortable && emit('sort', column)"
            @mousedown="reorderable && onHeaderMouseDown($event, column)"
          >
            <span class="th-name">
              <BaseIcon v-if="columnInfo[column]?.isPrimaryKey" name="key" :size="12" class="pk" />
              <span><span v-if="columnInfo[column]?.tableLabel" class="th-tbl">{{ columnInfo[column].tableLabel }}.</span>{{ columnInfo[column]?.name ?? column }}</span>
              <span v-if="sortable && orderBy === column" class="dir">{{ descending ? '▼' : '▲' }}</span>
            </span>
            <span v-if="columnInfo[column]?.dataType" class="th-type">{{ columnInfo[column].dataType }}</span>
            <input
              v-if="filterText"
              class="th-filter"
              :class="{ on: filterText[column]?.trim() }"
              :value="filterText[column] ?? ''"
              :placeholder="PLACEHOLDERS[kinds[c]] ?? 'contains…'"
              spellcheck="false"
              @click.stop
              @input="emit('filter-text', column, $event.target.value)"
              @keydown.enter="emit('apply-filters')"
            >
            <div class="col-resize-handle" @click.stop @mousedown="startResize($event, column)" @dblclick="autoFitColumn($event, column)"></div>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="filterText && !rows.length" class="no-rows">
          <td></td>
          <td :colspan="columns.length">No rows match these filters</td>
        </tr>
        <!-- Spacers reserve the scroll extent of the rows above and below the window. -->
        <tr v-if="padTop > 0" class="vspacer" aria-hidden="true">
          <td :colspan="columns.length + 1" :style="{ height: padTop + 'px' }"></td>
        </tr>
        <tr
          v-for="vrow in virtualRows"
          :key="vrow.index"
          class="datarow"
          :class="{
            selrow: isRowSelected(vrow.index), stripe: vrow.index % 2 === 1,
            'pending-delete': rowStatus(vrow.index) === 'deleted', 'pending-insert': rowStatus(vrow.index) === 'inserted',
            flash: flashedRow === vrow.index,
          }"
          @animationend="flashedRow = -1"
        >
          <td class="rownum" @click="selectRow($event, vrow.index)">{{ rowLabel ? rowLabel(vrow.index) : rowOffset + vrow.index + 1 }}</td>
          <td
            v-for="(value, c) in rows[vrow.index]"
            :key="c"
            :class="[value === null ? 'null' : kinds[c], { editable: canEdit(columns[c], vrow.index), selcell: isSelectedCell(vrow.index, columns[c]) }]"
            :style="thWidthStyle(columns[c])"
            @click="onCellClick($event, vrow.index, columns[c])"
            @contextmenu="openCellCtx($event, vrow.index, columns[c])"
            @dblclick="startEdit(vrow.index, columns[c], value)"
          >
            <span v-if="editing && editing.row === vrow.index && editing.column === columns[c]" class="pg-editing">
              <input
                ref="input"
                v-model="editing.text"
                class="pg-edit"
                @keydown.enter="commit"
                @keydown.esc.prevent="editing = null"
                @blur="commit"
              >
              <!-- mousedown.prevent keeps the input focused, so its blur doesn't save the text first. -->
              <button
                v-if="columnInfo[columns[c]]?.nullable"
                class="pg-null"
                title="Set to NULL"
                @mousedown.prevent
                @click="setNull"
              >NULL</button>
            </span>
            <span v-else-if="kinds[c] === 'enum' && value !== null" class="enum-pill">{{ value }}</span>
            <template v-else>{{ formatCell(value) }}</template>
          </td>
        </tr>
        <tr v-if="padBottom > 0" class="vspacer" aria-hidden="true">
          <td :colspan="columns.length + 1" :style="{ height: padBottom + 'px' }"></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-if="reordering" class="drag-ghost" :style="{ left: ghost.x + 14 + 'px', top: ghost.y + 14 + 'px' }">{{ ghost.label }}</div>
  <div
    v-if="dropIndicator"
    class="drop-indicator"
    :style="{ left: dropIndicator.left + 'px', top: dropIndicator.top + 'px', height: dropIndicator.height + 'px' }"
  ></div>

  <ContextMenu
    v-if="cellCtx"
    :menu="{ x: cellCtx.x, y: cellCtx.y, items: CELL_MENU }"
    @pick="cellCtxPick"
    @close="cellCtx = null"
  />
</template>

<style scoped>
.pg-grid { flex: 1; min-height: 0; overflow: auto; background: var(--bg-window); }
/* Separate borders: collapsed ones don't travel with the sticky header and gutter. */
table { border-collapse: separate; border-spacing: 0; font-size: 12.5px; }
th, td {
  border-right: 1px solid var(--grid-line);
  border-bottom: 1px solid var(--grid-line);
  padding: 5px 12px;
  white-space: nowrap;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}
th {
  position: sticky; top: 0; z-index: 2;
  background: var(--bg-panel-2);
  border-bottom-color: var(--border);
  color: var(--text);
  font-weight: 600;
  vertical-align: top;
}
th.sortable { cursor: pointer; }
/* A held header shows the closed hand across the headers, over sorting's pointer. */
table.pressed thead th, table.pressed .col-resize-handle { cursor: grabbing; }
/* Straddles the column's right border; the sticky th is its containing block. */
.col-resize-handle {
  position: absolute; top: 0; right: 0; z-index: 1;
  width: 12px; height: 100%;
  transform: translateX(50%);
  cursor: col-resize;
}
.th-name { display: flex; align-items: center; gap: 5px; }
.th-tbl { font-weight: 400; color: var(--text-faint); }
.th-type { display: block; margin-top: 1px; font: 400 10.5px var(--mono); color: var(--text-faint); }
.pk { color: var(--warn); flex: none; }
.dir { color: var(--accent); font-size: 9px; }
.th-filter {
  display: block; width: 100%; min-width: 92px; box-sizing: border-box;
  margin-top: 5px; height: 22px; padding: 0 7px;
  background: var(--bg-input); color: var(--text);
  border: 1px solid var(--border-soft); border-radius: 4px;
  font: 400 11.5px var(--mono); outline: none;
}
.th-filter::placeholder { color: var(--text-faint); }
.th-filter:focus, .th-filter.on { border-color: var(--accent); }
.no-rows td { padding: 18px 12px; color: var(--text-faint); font-style: italic; background: none; }
.rownum {
  position: sticky; left: 0; z-index: 1;
  width: 38px; text-align: right;
  background: var(--bg-panel-2); color: var(--text-faint);
  font: 11px var(--mono);
}
th.rownum { z-index: 3; vertical-align: bottom; padding-bottom: 10px; }
.funnel { display: block; margin-left: auto; color: var(--text-faint); }
.funnel.on { color: var(--accent); }
/* Keyed off the row index rather than nth-child: the two spacer rows flip the
   parity, so every scroll would otherwise restripe the whole grid. */
tbody tr.stripe td { background: var(--bg-row-alt); }
.vspacer td { padding: 0; border: none; background: none; }
tbody tr:hover td { background: var(--bg-hover); }
tbody tr td.rownum { background: var(--bg-panel-2); cursor: pointer; }
tbody tr.selrow td { background: var(--bg-selected); }
/* An accent bar down the gutter marks the selected rows, as in the MongoDB grid. */
tbody tr.selrow td.rownum { color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
td.selcell { outline: 2px solid var(--accent); outline-offset: -2px; }
/* Staged, unsaved row state (tableStage.js) — nothing here has reached the server yet. */
tbody tr.pending-delete td { background: var(--danger-bg); color: var(--danger-text); text-decoration: line-through; }
tbody tr.pending-delete td.rownum { text-decoration: none; }
tbody tr.pending-insert td { background: var(--success-bg); }
tbody tr.flash td { animation: row-flash 2.4s ease-out; }
@keyframes row-flash { from { background: color-mix(in srgb, var(--accent) 30%, transparent); } }
/* Reduced motion: hold the highlight, then drop it, rather than fade. */
@media (prefers-reduced-motion: reduce) { tbody tr.flash td { animation-timing-function: steps(1, end); } }
/* A dragged header's label follows the pointer; a line marks where it will land. */
.drag-ghost {
  position: fixed; z-index: 200; pointer-events: none;
  padding: 4px 9px; border-radius: 6px;
  background: var(--accent); color: #fff;
  font-size: 12px; white-space: nowrap;
  box-shadow: 0 6px 18px rgba(0, 0, 0, .45);
}
.drop-indicator { position: fixed; z-index: 10; width: 2px; background: var(--accent); pointer-events: none; }
td { color: var(--text); }
td.null { color: var(--text-faint); font-style: italic; font-size: 11.5px; }
td.num  { color: var(--warn); text-align: right; font-family: var(--mono); }
td.bool { color: var(--warn); font-family: var(--mono); }
td.str  { color: var(--cell-str-green); }
td.date { color: var(--text-dim); font-family: var(--mono); }
td.editable { cursor: text; }
.enum-pill {
  display: inline-block; padding: 0 7px; border-radius: 9px; font-size: 11.5px; line-height: 17px;
  background: var(--bg-active); color: var(--text); border: 1px solid var(--border-soft);
}
/* The editor has to fit inside an ordinary row's height. The virtualizer estimates
   every row from one measurement, so a row that grows while it is edited drifts the
   scroll extent under it — hence the negative margins, which buy the input's border
   back out of the cell's padding instead of out of the row. */
.pg-editing { display: flex; align-items: center; gap: 4px; margin: -3px 0; }
.pg-null {
  flex: none; height: 22px; padding: 0 6px; border-radius: 3px; cursor: pointer;
  background: var(--bg-input); color: var(--text-faint); border: 1px solid var(--border-soft);
  font: italic 11px var(--mono);
}
.pg-null:hover { color: var(--text); border-color: var(--accent); }
.pg-edit {
  width: 100%; min-width: 120px; height: 22px;
  background: var(--bg-input); color: var(--text);
  border: 1px solid var(--accent); border-radius: 3px;
  font: inherit; padding: 1px 4px;
}
</style>
