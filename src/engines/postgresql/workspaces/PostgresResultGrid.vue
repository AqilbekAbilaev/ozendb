<script setup>
import { ref, computed, nextTick } from 'vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import { formatCell, cellKind } from './formatCell.js'

// Rows arrive as arrays aligned to `columns`, so a repeated column name stays its own
// column. Sorting and editing are opt-in: the query tab shows results read-only, and
// without `columnInfo` (types, primary keys), since a query's columns aren't a table's.
const props = defineProps({
  columns:    { type: Array,    required: true },
  rows:       { type: Array,    required: true },
  columnInfo: { type: Object,   default: () => ({}) },
  rowOffset:  { type: Number,   default: 0 },
  orderBy:    { type: String,   default: null },
  descending: { type: Boolean,  default: false },
  sortable:   { type: Boolean,  default: false },
  // The table tab's per-column filter boxes; typing reports the text, Enter applies.
  filterText: { type: Object,   default: null },
  canEdit:    { type: Function, default: () => false },
  editText:   { type: Function, default: (column, value) => (value === null ? '' : formatCell(value)) },
})
const emit = defineEmits(['sort', 'save', 'filter-text', 'apply-filters'])

const PLACEHOLDERS = { num: 'e.g. >100', date: 'e.g. 2026-09', bool: 'true / false' }

const kinds = computed(() => props.columns.map(c => cellKind(props.columnInfo[c]?.dataType)))

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
</script>

<template>
  <div class="pg-grid">
    <table>
      <thead>
        <tr>
          <th class="rownum"></th>
          <th
            v-for="(column, c) in columns"
            :key="c"
            :class="{ sortable }"
            @click="sortable && emit('sort', column)"
          >
            <span class="th-name">
              <BaseIcon v-if="columnInfo[column]?.isPrimaryKey" name="key" :size="12" class="pk" />
              {{ column }}
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
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="filterText && !rows.length" class="no-rows">
          <td></td>
          <td :colspan="columns.length">No rows match these filters</td>
        </tr>
        <tr v-for="(row, r) in rows" :key="r">
          <td class="rownum">{{ rowOffset + r + 1 }}</td>
          <td
            v-for="(value, c) in row"
            :key="c"
            :class="[value === null ? 'null' : kinds[c], { editable: canEdit(columns[c]) }]"
            @dblclick="startEdit(r, columns[c], value)"
          >
            <input
              v-if="editing && editing.row === r && editing.column === columns[c]"
              ref="input"
              v-model="editing.text"
              class="pg-edit"
              @keydown.enter="commit"
              @keydown.esc.prevent="editing = null"
              @blur="commit"
            >
            <template v-else>{{ formatCell(value) }}</template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.pg-grid { flex: 1; min-height: 0; overflow: auto; }
/* Separate borders: collapsed ones don't travel with the sticky header and gutter. */
table { border-collapse: separate; border-spacing: 0; font-family: var(--mono); font-size: 12.5px; }
th, td {
  border-right: 1px solid var(--grid-line);
  border-bottom: 1px solid var(--grid-line);
  padding: 4px 8px;
  white-space: nowrap;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}
th {
  position: sticky; top: 0; z-index: 2;
  background: var(--bg-toolbar);
  color: var(--text-dim);
  font-weight: 600;
  vertical-align: bottom;
}
th.sortable { cursor: pointer; }
th.sortable:hover { color: var(--text); }
.th-name { display: flex; align-items: center; gap: 4px; }
.th-type { display: block; font-weight: 400; font-size: 10.5px; color: var(--text-faint); margin-top: 1px; }
.pk { color: var(--warn); flex: none; }
.dir { font-size: 9px; }
.th-filter {
  display: block; width: 100%; min-width: 92px; box-sizing: border-box;
  margin-top: 5px; height: 22px; padding: 0 7px;
  background: var(--bg-input); color: var(--text);
  border: 1px solid var(--border-soft); border-radius: 4px;
  font: 400 11.5px var(--mono); outline: none;
}
.th-filter::placeholder { color: var(--text-faint); }
.th-filter:focus, .th-filter.on { border-color: var(--accent); }
.no-rows td { padding: 18px 12px; color: var(--text-faint); font-style: italic; }
.rownum {
  position: sticky; left: 0; z-index: 1;
  min-width: 40px; text-align: right;
  background: var(--bg-panel-2); color: var(--text-faint);
  border-right-color: var(--border-soft);
}
th.rownum { z-index: 3; }
tbody tr:nth-child(even) { background: var(--bg-row-alt); }
td { color: var(--text); }
td.null { color: var(--text-faint); font-style: italic; }
td.num  { color: var(--cell-num); text-align: right; }
td.bool { color: var(--cell-num); }
td.str  { color: var(--cell-str-green); }
td.date { color: var(--text-dim); }
td.editable { cursor: text; }
.pg-edit {
  width: 100%; min-width: 120px;
  background: var(--bg-input); color: var(--text);
  border: 1px solid var(--accent); border-radius: 3px;
  font: inherit; padding: 1px 4px;
}
</style>
