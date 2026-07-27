<script setup>
import { ref, computed } from 'vue'
import BaseIcon from './BaseIcon.vue'
import { isEjsonScalar } from '../../utils/mongoFormat'

// Recursive tree node. Renders one row (key / value / type) and, when expanded,
// its children — re-using itself via filename self-reference. The top-level
// caller (ResultsPanel) loops the result documents and passes each as a root.
const props = defineProps({
  label:    { type: String,  required: true },
  value:    { default: undefined },
  depth:    { type: Number,  default: 0 },
  expanded: { type: Boolean, default: false },
  // Namespaced path of THIS node (e.g. "0.address.city"); root nodes get the doc index.
  // Tags the row (data-path) for search highlighting and lines up with expandPaths.
  path:        { type: String,  default: '' },
  // While a search is active, every ancestor path of a match is in this set so matched
  // branches auto-expand; nodes outside it stay collapsed (keeps the render cheap).
  expandPaths: { default: null },
  searching:   { type: Boolean, default: false },
})

// User's manual expand state. During a search a node is also forced open when it's an
// ancestor of a match (its path is in expandPaths), revealing hits without expanding
// the whole tree.
const localOpen = ref(props.expanded)
const open = computed(() =>
  props.searching ? (props.expandPaths?.has(props.path) || localOpen.value) : localOpen.value
)

// MongoDB extended-JSON wrappers that should read as a single scalar, not an
// expandable object (e.g. {"$oid": "..."} is an ObjectId, not a sub-document).


// type token reused from the table view's TYPE_ICON map
const typeKind = computed(() => {
  const v = props.value
  if (props.label === '_id' || (isEjsonScalar(v) && '$oid' in v)) return 'id'
  if (isEjsonScalar(v) && '$date' in v) return 'date'
  if (isEjsonScalar(v)) return 'num'
  if (typeof v === 'number') return 'num'
  if (typeof v === 'boolean') return 'bool'
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v) || typeof v === 'object') return 'obj'
  return 'str'
})

const TYPE_ICON  = { id: 'typeId', str: 'typeStr', num: 'typeNum', date: 'typeDate', bool: 'typeBool', null: 'typeNull', obj: 'typeObj' }
const TYPE_CLASS = { id: 'cell-oid', str: 'cell-str', num: 'cell-num', date: '', bool: 'cell-num', null: 'cell-faint', obj: 'cell-faint' }

// BSON-style label for the type column
const typeLabel = computed(() => {
  const v = props.value
  if (v === null || v === undefined) return 'Null'
  if (Array.isArray(v)) return 'Array'
  if (isEjsonScalar(v)) {
    const k = Object.keys(v)[0]
    return {
      $oid: 'ObjectId', $date: 'Date', $numberLong: 'Int64',
      $numberDecimal: 'Decimal128', $numberInt: 'Int32',
      $numberDouble: 'Double', $timestamp: 'Timestamp',
    }[k]
  }
  if (typeof v === 'object') return 'Object'
  if (typeof v === 'string') return 'String'
  if (typeof v === 'boolean') return 'Boolean'
  if (typeof v === 'number') return Number.isInteger(v) ? 'Int32' : 'Double'
  return 'String'
})

const children = computed(() => {
  const v = props.value
  if (isEjsonScalar(v) || v === null || typeof v !== 'object') return []
  if (Array.isArray(v)) return v.map((el, i) => ({ label: `[${i}]`, value: el, path: props.path + '[' + i + ']' }))
  return Object.entries(v).map(([k, val]) => ({ label: k, value: val, path: props.path ? props.path + '.' + k : k }))
})

const expandable = computed(() => children.value.length > 0)

const preview = computed(() => {
  const v = props.value
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return `"${v}"`
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `Array [ ${v.length} ${v.length === 1 ? 'element' : 'elements'} ]`
  if (isEjsonScalar(v)) {
    if ('$oid' in v) return `ObjectId("${v.$oid}")`
    if ('$date' in v) {
      const d = v.$date
      if (typeof d === 'string') return d
      if (d && typeof d === 'object' && '$numberLong' in d) return new Date(parseInt(d.$numberLong)).toISOString()
      return String(d)
    }
    return String(Object.values(v)[0])
  }
  const n = Object.keys(v).length
  return `{ ${n} ${n === 1 ? 'field' : 'fields'} }`
})

function toggle() {
  if (expandable.value) localOpen.value = !localOpen.value
}
</script>

<template>
  <div class="tnode">
    <div class="trow" :class="{ root: depth === 0 }" :data-path="path" @click="toggle">
      <span class="tkey-col" :style="{ paddingLeft: (depth * 16 + 6) + 'px' }">
        <span class="ttoggle" :class="{ hidden: !expandable }">
          <BaseIcon :name="open ? 'caretDown' : 'caret'" :size="12" />
        </span>
        <span class="ticon"><BaseIcon :name="TYPE_ICON[typeKind]" :size="14" /></span>
        <span class="tkey">{{ label }}</span>
      </span>
      <span class="tval-col" :class="TYPE_CLASS[typeKind]">{{ preview }}</span>
      <span class="ttype-col">{{ typeLabel }}</span>
    </div>
    <template v-if="open && expandable">
      <TreeView
        v-for="c in children"
        :key="c.label"
        :label="c.label"
        :value="c.value"
        :depth="depth + 1"
        :path="c.path"
        :expand-paths="expandPaths"
        :searching="searching"
      />
    </template>
  </div>
</template>

<style scoped>
.trow {
  display: grid;
  grid-template-columns: minmax(220px, 1.4fr) minmax(160px, 2fr) 110px;
  align-items: center;
  height: 25px;
  font-family: var(--mono);
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  cursor: default;
}
.trow:hover { background: var(--bg-panel-2); }
.trow.root { background: var(--bg-toolbar); }
.trow.root:hover { background: var(--bg-panel-2); }
/* Search highlight — classes toggled imperatively by TreeResultView (data-path lookup).
   !important so a hit reads clearly over the root/hover backgrounds, like the grid does. */
.trow.search-hit    { background: var(--search-hit) !important; }
.trow.search-active { background: var(--search-active) !important; }

.tkey-col {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  border-right: 1px solid var(--border);
  padding-right: 8px;
  height: 100%;
}
.ttoggle {
  display: inline-flex;
  align-items: center;
  color: var(--text-dim);
  cursor: pointer;
  width: 12px;
  flex: none;
}
.ttoggle.hidden { visibility: hidden; }
.ticon { display: inline-flex; align-items: center; color: var(--text-dim); flex: none; }
.tkey { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.tval-col {
  padding: 0 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-right: 1px solid var(--border);
  height: 100%;
  display: flex;
  align-items: center;
}
.ttype-col {
  padding: 0 8px;
  color: var(--text-faint);
  white-space: nowrap;
}

.cell-oid   { color: var(--link); }
.cell-str   { color: var(--cell-str-green); }
.cell-num   { color: var(--cell-num); }
.cell-faint { color: var(--text-faint); }
</style>
