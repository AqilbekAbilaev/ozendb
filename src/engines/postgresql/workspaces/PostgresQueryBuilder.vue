<script setup>
import { ref, computed, watch, toRaw } from 'vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseCheckbox from '../../../components/base/BaseCheckbox.vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseSelect from '../../../components/base/BaseSelect.vue'
import SegmentedControl from '../../../components/base/SegmentedControl.vue'
import { cellKind } from './formatCell.js'
import { operatorsFor, rowsFromParts, partsFromRows } from './builderRows.js'

// The table tab's Query Builder: its joins, the filter boxes as a list of conditions,
// the shown columns, and the sort. Changes apply at once, except a value being typed,
// which applies on Enter as in the grid's boxes. The checkboxes switch a condition or
// a whole section off without losing it (`pauses`, see builderPauses.js).
const props = defineProps({
  table:      { type: String, required: true },
  columns:    { type: Array,  required: true },
  columnInfo: { type: Object, required: true },
  filterText: { type: Object, required: true },
  orderBy:    { type: String, default: null },
  descending: { type: Boolean, default: false },
  // Empty shows every column.
  shownColumns: { type: Array, default: () => [] },
  // The tab's joins and the ones it could add, as usePostgresTable keeps them, and
  // each table's name in the query (the browsed table's first).
  joins:      { type: Array,  default: () => [] },
  joinOffers: { type: Array,  default: () => [] },
  tableNames: { type: Array,  default: () => [] },
  pauses:     { type: Object, required: true },
})
const emit = defineEmits(['filter-text', 'sort', 'columns', 'add-join', 'join-kind', 'remove-join', 'paused-text', 'apply'])

// A column as the SQL names it: `name`, or `table.name` once the tab joins others.
function label(key) {
  const info = props.columnInfo[key]
  return info?.tableLabel ? `${info.tableLabel}.${info.name}` : info?.name ?? key
}
const joinName = (i) => props.tableNames[i + 1]
const kindOptions = computed(() => [
  { value: 'left', label: `Keep all ${props.table}, even without a match` },
  { value: 'inner', label: 'Only rows that have a match' },
])
const offerOptions = computed(() => props.joinOffers.map((o, i) => ({ value: i, label: o.label })))

const kinds = computed(() => Object.fromEntries(props.columns.map(c => [c, cellKind(props.columnInfo[c]?.dataType)])))

// Rows are kept here rather than derived, so a condition still missing its value
// survives; they're re-read only when the boxes change from outside the panel.
const rows = ref([])
let sent = {}
watch(() => [props.filterText, props.pauses.conditions], ([texts, paused]) => {
  if (toRaw(texts) !== sent.texts || toRaw(paused) !== sent.paused) rows.value = rowsFromParts(texts, paused, kinds.value)
}, { immediate: true })

function commit(next, apply = true) {
  rows.value = next
  sent = partsFromRows(next, kinds.value)
  emit('filter-text', sent.texts)
  emit('paused-text', sent.paused)
  if (apply) emit('apply')
}
const update = (i, patch, apply) => commit(rows.value.map((r, j) => (j === i ? { ...r, ...patch } : r)), apply)
const remove = (i) => commit(rows.value.filter((_, j) => j !== i))

const whereOn = computed(() => !rows.value.length || rows.value.some(r => r.on))
function toggleWhere() {
  if (rows.value.length) commit(rows.value.map(r => ({ ...r, on: !whereOn.value })))
}

const used = computed(() => rows.value.map(r => r.column))
function add() {
  const column = props.columns.find(c => !used.value.includes(c))
  if (column) commit([...rows.value, { column, op: operatorsFor(kinds.value[column])[0].op, value: '', on: true }], false)
}
function pickColumn(i, column) {
  update(i, { column, op: operatorsFor(kinds.value[column])[0].op, value: '' })
}

const columnOptions = (current) => props.columns.map(c => ({ value: c, label: label(c), disabled: c !== current && used.value.includes(c) }))
const opOptions = (column) => operatorsFor(kinds.value[column]).map(o => ({ value: o.op, label: o.label }))
const needsValue = (op) => op !== 'isNull' && op !== 'notNull'

// Ticking keeps the table's own column order; ticking none shows them all.
function toggleColumn(column) {
  const shown = props.shownColumns
  emit('columns', props.columns.filter(c => (c === column) !== shown.includes(c)))
}

const sortOptions = computed(() => [{ value: '', label: 'No sorting' }, ...props.columns.map(c => ({ value: c, label: label(c) }))])
const DIRECTIONS = [{ value: 'asc', label: '↑ Ascending' }, { value: 'desc', label: '↓ Descending' }]
</script>

<template>
  <aside class="vqb">
    <div class="vqb-section">
      <div class="vqb-head">Tables</div>
      <div class="vqb-body stack">
        <div class="pvq-base"><BaseIcon name="table" :size="14" /><b>{{ table }}</b><span class="tag">main table</span></div>
        <div v-for="(j, i) in joins" :key="j.key" class="cond join">
          <div class="cond-line">
            <BaseIcon name="table" :size="14" class="ti" />
            <b class="grow">{{ joinName(i) }}</b>
            <BaseButton icon="trash" size="sm" :icon-size="18" title="Remove join" @click="emit('remove-join', j.key)" />
          </div>
          <div class="cond-line">
            <BaseSelect class="grow" size="sm" :model-value="j.kind" :options="kindOptions" @update:model-value="emit('join-kind', j.key, $event)" />
          </div>
          <div class="cond-line"><span class="onl">where</span><span class="pill grow onv">{{ joinName(i) }}.{{ j.column }}</span></div>
          <div class="cond-line"><span class="onl">equals</span><span class="pill grow onv">{{ label(j.equals) }}</span></div>
        </div>
        <BaseSelect
          v-if="joinOffers.length"
          :model-value="''"
          :options="offerOptions"
          placeholder="+ Join a related table…"
          @update:model-value="emit('add-join', joinOffers[$event])"
        />
        <div v-else class="empty">No{{ joins.length ? ' more' : '' }} related tables.</div>
      </div>
    </div>

    <div class="vqb-section">
      <div class="vqb-head">
        Where
        <span class="cb" :class="{ on: whereOn }" title="Apply these conditions" @click="toggleWhere">
          <BaseIcon v-if="whereOn" name="check" :size="12" />
        </span>
      </div>
      <div class="vqb-body stack">
        <div class="hint">Show rows that match <b>all</b> of these:</div>
        <div v-if="!rows.length" class="empty">No conditions — all rows are shown.</div>
        <div v-for="(r, i) in rows" :key="i" class="cond" :class="{ off: !r.on }">
          <div class="cond-line">
            <BaseSelect class="grow" size="sm" :model-value="r.column" :options="columnOptions(r.column)" @update:model-value="pickColumn(i, $event)" />
            <BaseSelect class="op" size="sm" :model-value="r.op" :options="opOptions(r.column)" @update:model-value="update(i, { op: $event })" />
            <BaseButton icon="trash" size="sm" :icon-size="18" title="Remove" @click="remove(i)" />
          </div>
          <div class="cond-line">
            <span class="pill type-pill" :title="columnInfo[r.column]?.dataType">{{ columnInfo[r.column]?.dataType }}</span>
            <BaseInput
              v-if="needsValue(r.op)"
              class="pill grow cond-val"
              :model-value="r.value"
              :placeholder="r.op === 'in' ? 'a, b, c, then Enter' : 'value, then Enter'"
              spellcheck="false"
              @update:model-value="update(i, { value: $event }, false)"
              @enter="emit('apply')"
            />
            <span v-else class="grow"></span>
            <span class="cb sm" :class="{ on: r.on }" title="Apply this condition" @click="update(i, { on: !r.on })">
              <BaseIcon v-if="r.on" name="check" :size="11" />
            </span>
          </div>
        </div>
        <button class="add" :disabled="used.length === columns.length" @click="add"><BaseIcon name="plus" :size="13" /> Add condition</button>
      </div>
    </div>

    <div class="vqb-section">
      <div class="vqb-head">
        Columns
        <span class="cb" :class="{ on: pauses.columnsOn }" title="Show only the ticked columns" @click="pauses.toggleColumns()">
          <BaseIcon v-if="pauses.columnsOn" name="check" :size="12" />
        </span>
      </div>
      <div class="vqb-body stack cols" :class="{ off: !pauses.columnsOn }">
        <div class="count">{{ shownColumns.length ? `${shownColumns.length} of ${columns.length} shown` : 'All shown' }}</div>
        <template v-for="(c, i) in columns" :key="c">
          <div v-if="joins.length && columnInfo[c]?.tableLabel !== columnInfo[columns[i - 1]]?.tableLabel" class="grp">
            {{ columnInfo[c]?.tableLabel }}
          </div>
          <label class="colrow">
            <BaseCheckbox :model-value="shownColumns.includes(c)" @update:model-value="toggleColumn(c)" />
            <span :class="{ dim: shownColumns.length && !shownColumns.includes(c) }">{{ columnInfo[c]?.name ?? c }}</span>
            <span class="type">{{ columnInfo[c]?.dataType }}</span>
          </label>
        </template>
        <button v-if="shownColumns.length" class="link" @click="emit('columns', [])">Show all columns</button>
      </div>
    </div>

    <div class="vqb-section">
      <div class="vqb-head">
        Order by
        <span class="cb" :class="{ on: pauses.sortOn }" title="Sort the rows" @click="pauses.toggleSort()">
          <BaseIcon v-if="pauses.sortOn" name="check" :size="12" />
        </span>
      </div>
      <div class="vqb-body stack" :class="{ off: !pauses.sortOn }">
        <BaseSelect :model-value="orderBy ?? ''" :options="sortOptions" @update:model-value="emit('sort', $event || null, descending)" />
        <SegmentedControl
          v-if="orderBy"
          class="dir"
          variant="subtle"
          :model-value="descending ? 'desc' : 'asc'"
          :options="DIRECTIONS"
          @update:model-value="emit('sort', orderBy, $event === 'desc')"
        />
      </div>
    </div>
  </aside>
</template>

<style scoped>
.stack { display: flex; flex-direction: column; gap: 8px; }
.stack .cond { margin-bottom: 0; }
.off { opacity: .5; }
.pvq-base { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text); }
.pvq-base svg { color: var(--text-faint); }
.tag { margin-left: auto; font-size: 11px; color: var(--text-faint); }
.hint { font-size: 12px; color: var(--text-dim); }
.empty { font-size: 12px; font-style: italic; color: var(--text-faint); }
.grow { flex: 1; min-width: 0; }
.op { flex: none; width: 112px; }
.type-pill { max-width: 110px; overflow: hidden; text-overflow: ellipsis; }
.add {
  display: flex; align-items: center; justify-content: center; gap: 6px; height: 30px;
  background: none; border: 1px dashed var(--border-soft); border-radius: 6px;
  color: var(--text-faint); font-size: 12px; cursor: pointer;
}
.add:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.add:disabled { opacity: .4; cursor: default; }
.join { border-left: 2px solid var(--purple); }
.join b { font-size: 12.5px; color: var(--text); }
.ti { color: var(--text-faint); flex: none; }
.onl { flex: none; width: 44px; font-size: 11.5px; color: var(--text-faint); }
.onv { font-family: var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.grp { padding: 8px 4px 3px; font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--text-faint); }
.count { font-size: 11.5px; color: var(--text-faint); }
.cols { gap: 2px; }
.colrow {
  display: flex; align-items: center; gap: 9px; padding: 5px 4px; border-radius: 5px;
  font-size: 12.5px; color: var(--text); cursor: pointer;
}
.colrow:hover { background: var(--bg-hover); }
.dim { color: var(--text-faint); }
.type { margin-left: auto; font: 11px var(--mono); color: var(--text-faint); }
.link { align-self: flex-start; padding: 0 4px; background: none; border: 0; color: var(--link); font-size: 12px; cursor: pointer; }
.dir { align-self: stretch; }
.dir :deep(button) { flex: 1; justify-content: center; }
</style>
<style scoped src="../../../components/query/QueryBuilderPanel.css"></style>
