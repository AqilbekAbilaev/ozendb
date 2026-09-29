<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import ContextMenu from '../../../components/base/ContextMenu.vue'
import { formatCell, cellKind } from './formatCell.js'
import { valueText, rowsAsTsv, rowsAsJson } from './copyText.js'
import { useColumnResize } from '../../../composables/useColumnResize'
import { useColumnReorder } from '../../../composables/useColumnReorder'
import { useRowSelection } from '../../../composables/useRowSelection'
import { useGridCells } from '../../../composables/useGridCells'
import { useResultKeyboard } from '../../../composables/useResultKeyboard'

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
  orderBy:    { type: String,   default: null },
  descending: { type: Boolean,  default: false },
  sortable:   { type: Boolean,  default: false },
  // Headers drag to reorder, reported as `move-column`; the table tab keeps the order.
  reorderable: { type: Boolean, default: false },
  // The table tab's per-column filter boxes; typing reports the text, Enter applies.
  filterText: { type: Object,   default: null },
  canEdit:    { type: Function, default: () => false },
  editText:   { type: Function, default: (column, value) => (value === null ? '' : formatCell(value)) },
})
const emit = defineEmits(['sort', 'save', 'filter-text', 'apply-filters', 'move-column'])

const PLACEHOLDERS = { num: 'e.g. >100', date: 'e.g. 2026-09', bool: 'true / false', enum: 'e.g. a, b' }

const filtering = computed(() => Object.values(props.filterText ?? {}).some(text => text?.trim()))
const kinds = computed(() => props.columns.map(c => cellKind(props.columnInfo[c]?.dataType, props.columnInfo[c]?.enumValues)))

const { tableRef, startResize, autoFitColumn, thWidthStyle } = useColumnResize({ gridColumns: () => props.columns })

const rowSelection = useRowSelection({ activeTab: () => props.selection })
const { selectedCol, anchorRow, isRowSelected } = rowSelection
const { cellCtx, onCellClick, selectRow, openCellCtx } = useGridCells({ rows: rowSelection })

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
  else copy(rowsAsJson(props.columns, [props.rows[row]]))
  cellCtx.value = null
}

const gridWrapRef = ref(null)

const { onHeaderMouseDown, dragging: reordering, dropIndicator, ghost } = useColumnReorder({
  columns: () => props.columns,
  moveColumn: (column, insertBefore) => emit('move-column', column, insertBefore),
  tableRef, gridWrapRef,
  headerLabel: (column) => props.columnInfo[column]?.name ?? column,
  onBeforePress: commit,
})

useResultKeyboard({
  selection: () => props.selection, rows: rowSelection, cellCtx, copySelection, tableRef, gridWrapRef,
  rowCount: () => props.rows.length, columns: () => props.columns, editing: () => !!editing.value,
})

const editing = ref(null)   // { row, column, text, seed }
const input = ref(null)

async function startEdit(rowIndex, column, value) {
  if (!props.canEdit(column)) return
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
</script>

<template>
  <div ref="gridWrapRef" class="pg-grid">
    <table ref="tableRef">
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
            <span v-if="columnInfo[column]" class="th-type">{{ columnInfo[column].dataType }}</span>
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
        <tr v-for="(row, r) in rows" :key="r" :class="{ selrow: isRowSelected(r) }">
          <td class="rownum" @click="selectRow($event, r)">{{ rowOffset + r + 1 }}</td>
          <td
            v-for="(value, c) in row"
            :key="c"
            :class="[value === null ? 'null' : kinds[c], { editable: canEdit(columns[c]), selcell: isSelectedCell(r, columns[c]) }]"
            :style="thWidthStyle(columns[c])"
            @click="onCellClick($event, r, columns[c])"
            @contextmenu="openCellCtx($event, r, columns[c])"
            @dblclick="startEdit(r, columns[c], value)"
          >
            <span v-if="editing && editing.row === r && editing.column === columns[c]" class="pg-editing">
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
tbody tr:nth-child(even) td { background: var(--bg-row-alt); }
tbody tr:hover td { background: var(--bg-hover); }
tbody tr td.rownum { background: var(--bg-panel-2); cursor: pointer; }
tbody tr.selrow td { background: var(--bg-selected); }
/* An accent bar down the gutter marks the selected rows, as in the MongoDB grid. */
tbody tr.selrow td.rownum { color: var(--accent); box-shadow: inset 3px 0 0 var(--accent); }
td.selcell { outline: 2px solid var(--accent); outline-offset: -2px; }
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
.pg-editing { display: flex; align-items: center; gap: 4px; }
.pg-null {
  flex: none; padding: 1px 6px; border-radius: 3px; cursor: pointer;
  background: var(--bg-input); color: var(--text-faint); border: 1px solid var(--border-soft);
  font: italic 11px var(--mono);
}
.pg-null:hover { color: var(--text); border-color: var(--accent); }
.pg-edit {
  width: 100%; min-width: 120px;
  background: var(--bg-input); color: var(--text);
  border: 1px solid var(--accent); border-radius: 3px;
  font: inherit; padding: 1px 4px;
}
</style>
