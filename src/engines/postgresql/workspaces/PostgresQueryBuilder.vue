<script setup>
import { ref, computed, watch, toRaw } from 'vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseCheckbox from '../../../components/base/BaseCheckbox.vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import BaseInput from '../../../components/base/BaseInput.vue'
import BaseSelect from '../../../components/base/BaseSelect.vue'
import SegmentedControl from '../../../components/base/SegmentedControl.vue'
import { cellKind } from './formatCell.js'
import { operatorsFor, rowsFromBoxes, boxesFromRows } from './builderRows.js'

// The table tab's Query Builder: its joins, the filter boxes as a list of conditions,
// the shown columns, and the sort. Conditions edit the boxes (Run applies them, as
// typing in a box does); joins, columns and sort apply at once.
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
})
const emit = defineEmits(['filter-text', 'sort', 'columns', 'add-join', 'join-kind', 'remove-join', 'close'])

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
let sent = null
watch(() => props.filterText, (texts) => {
  if (toRaw(texts) !== sent) rows.value = rowsFromBoxes(texts, kinds.value)
}, { immediate: true })

function commit(next) {
  rows.value = next
  sent = boxesFromRows(next, kinds.value)
  emit('filter-text', sent)
}
const update = (i, patch) => commit(rows.value.map((r, j) => (j === i ? { ...r, ...patch } : r)))
const remove = (i) => commit(rows.value.filter((_, j) => j !== i))

const used = computed(() => rows.value.map(r => r.column))
function add() {
  const column = props.columns.find(c => !used.value.includes(c))
  if (column) commit([...rows.value, { column, op: operatorsFor(kinds.value[column])[0].op, value: '' }])
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
  <aside class="pvq">
    <section>
      <header>Tables<button class="pvq-close" title="Close" @click="emit('close')"><BaseIcon name="close" :size="12" /></button></header>
      <div class="body">
        <div class="pvq-base"><BaseIcon name="table" :size="14" /><b>{{ table }}</b><span class="tag">main table</span></div>
        <div v-for="(j, i) in joins" :key="j.key" class="cond join">
          <div class="line">
            <BaseIcon name="table" :size="14" class="ti" />
            <b class="grow">{{ joinName(i) }}</b>
            <BaseButton variant="ghost" icon="trash" size="sm" title="Remove join" @click="emit('remove-join', j.key)" />
          </div>
          <BaseSelect :model-value="j.kind" :options="kindOptions" @update:model-value="emit('join-kind', j.key, $event)" />
          <div class="line on"><span class="onl">where</span><span class="onv">{{ joinName(i) }}.{{ j.column }}</span></div>
          <div class="line on"><span class="onl">equals</span><span class="onv">{{ label(j.equals) }}</span></div>
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
    </section>

    <section>
      <header>Where</header>
      <div class="body">
        <div class="hint">Show rows that match <b>all</b> of these:</div>
        <div v-if="!rows.length" class="empty">No conditions — all rows are shown.</div>
        <div v-for="(r, i) in rows" :key="i" class="cond">
          <div class="line">
            <BaseSelect class="grow strong" :model-value="r.column" :options="columnOptions(r.column)" @update:model-value="pickColumn(i, $event)" />
            <BaseButton variant="ghost" icon="trash" size="sm" title="Remove" @click="remove(i)" />
          </div>
          <div class="line">
            <BaseSelect class="op" :model-value="r.op" :options="opOptions(r.column)" @update:model-value="update(i, { op: $event })" />
            <BaseInput
              v-if="needsValue(r.op)"
              class="grow val"
              :model-value="r.value"
              placeholder="value"
              spellcheck="false"
              @update:model-value="update(i, { value: $event })"
            />
          </div>
        </div>
        <button class="add" :disabled="used.length === columns.length" @click="add"><BaseIcon name="plus" :size="13" /> Add condition</button>
        <div v-if="rows.length" class="hint run-hint">Press Run to apply.</div>
      </div>
    </section>

    <section>
      <header>Columns<span class="count">{{ shownColumns.length ? `${shownColumns.length} of ${columns.length}` : 'all' }}</span></header>
      <div class="body cols">
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
    </section>

    <section>
      <header>Order by</header>
      <div class="body">
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
    </section>
  </aside>
</template>

<style scoped>
.pvq {
  position: absolute; top: 0; right: 0; bottom: 0; z-index: 40; width: 320px;
  display: flex; flex-direction: column; overflow-y: auto;
  background: var(--bg-panel); border-left: 1px solid var(--border);
  box-shadow: -10px 0 28px rgba(0, 0, 0, .28);
}
section { border-bottom: 1px solid var(--border); }
header {
  display: flex; align-items: center; height: 29px; padding: 0 12px;
  font-size: 13px; font-weight: 600; color: var(--text);
  background: var(--bg-panel-2); border-bottom: 1px solid var(--border);
}
.pvq-close {
  margin-left: auto; width: 22px; height: 22px; display: grid; place-items: center;
  background: none; border: 0; border-radius: 5px; color: var(--text-faint); cursor: pointer;
}
.pvq-close:hover { background: var(--bg-hover); color: var(--text); }
.body { padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.pvq-base { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text); }
.pvq-base svg { color: var(--text-faint); }
.tag { margin-left: auto; font-size: 11px; color: var(--text-faint); }
.hint { font-size: 12px; color: var(--text-dim); }
.run-hint { color: var(--text-faint); }
.empty { font-size: 12px; font-style: italic; color: var(--text-faint); }
.cond { display: flex; flex-direction: column; gap: 6px; padding-left: 10px; border-left: 2px solid var(--accent); }
.line { display: flex; align-items: center; gap: 6px; }
.grow { flex: 1; min-width: 0; }
.op { flex: none; width: 124px; }
.val { font-family: var(--mono); }
.add {
  display: flex; align-items: center; justify-content: center; gap: 6px; height: 30px;
  background: none; border: 1px dashed var(--border-soft); border-radius: 6px;
  color: var(--link); font-size: 12.5px; cursor: pointer;
}
.add:hover:not(:disabled) { border-color: var(--link); background: var(--bg-hover); }
.add:disabled { opacity: .4; cursor: default; }
.dir { align-self: stretch; }
.join { border-left-color: var(--purple); }
.ti { color: var(--text-faint); flex: none; }
.on .onl { flex: none; width: 44px; font-size: 11.5px; color: var(--text-faint); }
.on .onv {
  flex: 1; min-width: 0; padding: 5px 9px; border-radius: 6px;
  background: var(--bg-input); border: 1px solid var(--border-soft);
  font: 12px var(--mono); color: var(--text); overflow: hidden; text-overflow: ellipsis;
}
.grp { padding: 8px 4px 3px; font-size: 10.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--text-faint); }
.count { margin-left: auto; font-size: 11.5px; font-weight: 400; color: var(--text-faint); }
.cols { gap: 2px; }
.colrow {
  display: flex; align-items: center; gap: 9px; padding: 5px 4px; border-radius: 5px;
  font-size: 12.5px; color: var(--text); cursor: pointer;
}
.colrow:hover { background: var(--bg-hover); }
.dim { color: var(--text-faint); }
.type { margin-left: auto; font: 11px var(--mono); color: var(--text-faint); }
.link { align-self: flex-start; padding: 0 4px; background: none; border: 0; color: var(--link); font-size: 12px; cursor: pointer; }
.dir :deep(button) { flex: 1; justify-content: center; }
</style>
