<script setup>
import { ref, nextTick } from 'vue'
import { formatCell } from './formatCell.js'

// Rows arrive as arrays aligned to `columns`, so a repeated column name stays its own
// column. Sorting and editing are opt-in: the query tab shows results read-only.
const props = defineProps({
  columns:    { type: Array,    required: true },
  rows:       { type: Array,    required: true },
  orderBy:    { type: String,   default: null },
  descending: { type: Boolean,  default: false },
  sortable:   { type: Boolean,  default: false },
  canEdit:    { type: Function, default: () => false },
})
const emit = defineEmits(['sort', 'save'])

const editing = ref(null)   // { row, column, text }
const input = ref(null)

async function startEdit(rowIndex, column, value) {
  if (!props.canEdit(column)) return
  editing.value = { row: rowIndex, column, text: value === null ? '' : formatCell(value) }
  await nextTick()
  input.value?.[0]?.focus()
}

function commit() {
  const { row, column, text } = editing.value
  editing.value = null
  emit('save', row, column, text)
}
</script>

<template>
  <div class="pg-grid">
    <table>
      <thead>
        <tr>
          <th
            v-for="(column, c) in columns"
            :key="c"
            :class="{ sortable }"
            @click="sortable && emit('sort', column)"
          >
            {{ column }}
            <span v-if="sortable && orderBy === column" class="dir">{{ descending ? '▼' : '▲' }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, r) in rows" :key="r">
          <td
            v-for="(value, c) in row"
            :key="c"
            :class="{ null: value === null, editable: canEdit(columns[c]) }"
            @dblclick="startEdit(r, columns[c], value)"
          >
            <input
              v-if="editing && editing.row === r && editing.column === columns[c]"
              ref="input"
              v-model="editing.text"
              class="pg-edit"
              @keydown.enter="commit"
              @keydown.esc.prevent="editing = null"
              @blur="editing = null"
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
table { border-collapse: collapse; font-family: var(--mono); font-size: 12.5px; }
th, td {
  border: 1px solid var(--grid-line);
  padding: 4px 8px;
  white-space: nowrap;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: left;
}
th {
  position: sticky; top: 0;
  background: var(--bg-toolbar);
  color: var(--text-dim);
  font-weight: 600;
}
th.sortable { cursor: pointer; }
th.sortable:hover { color: var(--text); }
.dir { font-size: 9px; margin-left: 4px; }
tbody tr:nth-child(even) { background: var(--bg-row-alt); }
td { color: var(--text); }
td.null { color: var(--text-faint); font-style: italic; }
td.editable { cursor: text; }
.pg-edit {
  width: 100%; min-width: 120px;
  background: var(--bg-input); color: var(--text);
  border: 1px solid var(--accent); border-radius: 3px;
  font: inherit; padding: 1px 4px;
}
</style>
