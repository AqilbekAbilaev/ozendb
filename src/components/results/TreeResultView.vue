<script setup>
import { ref, computed, nextTick } from 'vue'
import { useResultSearch } from '../../composables/useResultSearch'
import TreeView from '../base/TreeView.vue'
import SearchBar from '../base/SearchBar.vue'
import { isEjsonScalar } from '../../utils/mongoFormat'

const props = defineProps({
  results: { type: Array, default: () => [] },
})

// MongoDB extended-JSON wrappers TreeView renders as a single scalar (e.g. {"$oid": …}
// is an ObjectId, not a sub-document). Flatten must treat them as leaves too, so match
// paths line up with the rows TreeView actually draws.

// Flatten each rendered node to { path, key, valLower } for scanning. Paths mirror the
// ones TreeView builds (dotted keys, [i] for array elements) so a match's path finds its
// row's data-path. Every document is namespaced by its index ("0.name", "1.name", …) so
// identically-keyed fields in different documents don't collide.
function emitNode(path, key, v, out) {
  if (isEjsonScalar(v)) {
    out.push({ path: path, key: key, valLower: String(Object.values(v)[0]).toLowerCase() })
  } else if (v === null || typeof v !== 'object') {
    out.push({ path: path, key: key, valLower: String(v).toLowerCase() })
  } else if (Array.isArray(v)) {
    out.push({ path: path, key: key, valLower: '' })
    v.forEach((el, i) => emitNode(path + '[' + i + ']', '[' + i + ']', el, out))
  } else {
    out.push({ path: path, key: key, valLower: '' })
    for (const [k, val] of Object.entries(v)) emitNode(path + '.' + k, k, val, out)
  }
}

const flatRows = computed(() => {
  const out = []
  props.results.forEach((doc, i) => {
    if (doc && typeof doc === 'object') {
      for (const [k, v] of Object.entries(doc)) emitNode(String(i) + '.' + k, k, v, out)
    }
  })
  return out
})

// All ancestor node paths of a match, cutting at each '.' and '[' so both object keys and
// array segments (including doubly-nested arrays like a[1].b[2]) are covered.
function ancestorsOf(path) {
  const out = []
  for (let i = 1; i < path.length; i++) {
    const c = path[i]
    if (c === '.' || c === '[') out.push(path.slice(0, i))
  }
  return out
}

// Matched paths in document order — the composable's match list. matchPaths/expandPaths
// are derived from it: the first for O(1) highlight lookups, the second to auto-expand
// only the branches that contain a hit.
const matches = computed(() => {
  const q = searchQuery.value.toLowerCase()
  if (!q) return []
  const out = []
  for (const row of flatRows.value) {
    if (row.key.toLowerCase().includes(q) || row.valLower.includes(q)) out.push(row.path)
  }
  return out
})

const matchPaths  = computed(() => new Set(matches.value))
const expandPaths = computed(() => {
  const set = new Set()
  for (const path of matches.value) for (const a of ancestorsOf(path)) set.add(a)
  return set
})

const treeBodyRef = ref(null)

// Toggle the highlight classes on the rendered rows. Ancestor auto-expand happens
// reactively via expandPaths, so this runs in nextTick — after those rows are on screen.
function applyHighlight() {
  const body = treeBodyRef.value
  if (!body) return
  const hits = matchPaths.value
  const active = searchIdx.value >= 0 ? (matches.value[searchIdx.value] ?? '') : ''
  for (const row of body.querySelectorAll('.trow')) {
    const path = row.getAttribute('data-path') || ''
    const isHit = hits.has(path)
    row.classList.toggle('search-hit', isHit)
    row.classList.toggle('search-active', isHit && path === active)
  }
}

// Scroll the active match into view. Matches by attribute (not a selector) so a key
// containing quotes/brackets can't break the lookup.
function scrollToActive() {
  const active = searchIdx.value >= 0 ? matches.value[searchIdx.value] : ''
  if (!active) return
  const body = treeBodyRef.value
  if (!body) return
  for (const row of body.querySelectorAll('.trow')) {
    if ((row.getAttribute('data-path') || '') === active) {
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      return
    }
  }
}

function reveal() {
  nextTick(() => { applyHighlight(); scrollToActive() })
}

const {
  open: searchOpen, count: matchCount, index: searchIdx, query: searchQuery,
  setOpen, setQuery, next: onNext, prev: onPrev, close: onClose,
} = useResultSearch({
  getMatches: () => matches.value,
  onActivate: reveal,   // next/prev: move highlight + scroll
  onApply:    reveal,   // query settled: highlight all + reveal first (or clear when empty)
  debounce:   150,
  resetOn:    () => props.results,
})
</script>

<template>
  <div class="tree-view">
    <div v-if="!results?.length" class="tree-empty">No documents</div>
    <template v-else>
      <SearchBar
        :open="searchOpen"
        :count="matchCount"
        :current="searchIdx"
        @update:open="setOpen"
        @update:query="setQuery"
        @next="onNext"
        @prev="onPrev"
        @close="onClose"
      />
      <div class="tree-scroll">
        <div class="tree-head">
          <span class="th-key">Key</span>
          <span class="th-val">Value</span>
          <span class="th-type">Type</span>
        </div>
        <div ref="treeBodyRef" class="tree-body">
          <TreeView
            v-for="(doc, i) in results"
            :key="i"
            :label="`(${i + 1})`"
            :value="doc"
            :depth="0"
            :path="String(i)"
            :expand-paths="expandPaths"
            :searching="searchQuery.length > 0"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tree-view { flex: 1; display: flex; flex-direction: column; min-height: 0; background: var(--bg-window); position: relative; overflow: hidden; }
.tree-scroll { flex: 1; overflow: auto; min-height: 0; }
.tree-empty { padding: 32px; color: var(--text-faint); font-size: 12px; }
.tree-head {
  display: grid;
  grid-template-columns: minmax(220px, 1.4fr) minmax(160px, 2fr) 110px;
  position: sticky;
  top: 0;
  z-index: 2;
  height: 26px;
  align-items: center;
  background: var(--bg-toolbar);
  color: var(--text-dim);
  font-weight: 600;
  font-size: 11px;
  border-bottom: 1px solid var(--border);
}
.tree-head span { padding: 0 8px; border-right: 1px solid var(--border); height: 100%; display: flex; align-items: center; }
.tree-head .th-type { border-right: none; }
</style>
