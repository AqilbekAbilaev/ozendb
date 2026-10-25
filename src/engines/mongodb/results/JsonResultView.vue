<script setup>
import { ref, computed } from 'vue'
import { Decoration, EditorView } from '@codemirror/view'
import { StateEffect, StateField, RangeSetBuilder } from '@codemirror/state'
import { mongoStringify } from '../../../utils/mongoFormat'
import { jsonViewerExtensions } from '../../../utils/jsonView'
import { useResultSearch } from '../../../composables/useResultSearch'
import CodeEditor from '../../../components/base/CodeEditor.vue'
import SearchBar from '../../../components/base/SearchBar.vue'

const props = defineProps({
  results: { type: Array, default: () => [] },
})

const text = computed(() => {
  const results = props.results
  if (!results || !results.length) return ''
  return results.map((doc) => mongoStringify(doc)).join('\n')
})

// ── search highlight decorations ──────────────────────────────────────
const searchHighlightMark = Decoration.mark({ class: 'cm-search-match' })
const searchActiveMark    = Decoration.mark({ class: 'cm-search-match-selected' })

// Build the highlight set from the already-scanned match ranges (sorted by `from`),
// rather than re-scanning the whole document a second time.
function buildDecorations(ranges, activeIdx) {
  if (!ranges.length) return Decoration.none
  const builder = new RangeSetBuilder()
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    builder.add(r.from, r.to, i === activeIdx ? searchActiveMark : searchHighlightMark)
  }
  return builder.finish()
}

const setSearchDecos = StateEffect.define()
const searchDecoField = StateField.define({
  create() { return Decoration.none },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setSearchDecos)) return e.value
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})

const jsonExtensions = computed(() => [
  ...jsonViewerExtensions(),
  searchDecoField,
])

// ── search ─────────────────────────────────────────────────────────────
// The scan + CM decorations are JSON-specific; the bar's open/index/debounce state
// lives in useResultSearch. `refresh` re-paints the highlight and reveals the active
// match — it doubles as the "clear" path (empty ranges → Decoration.none).
const cmRef   = ref(null)
const viewRef = ref(null)

function refresh() {
  const view = cmRef.value?.getView()
  if (!view) return
  view.dispatch({ effects: setSearchDecos.of(buildDecorations(matchRanges.value, searchIdx.value)) })
  scrollToMatch()
}

function scrollToMatch() {
  const m = matchRanges.value[searchIdx.value]
  if (!m) return
  const view = cmRef.value?.getView()
  if (!view) return
  view.dispatch({ selection: { anchor: m.from, head: m.to } })
  view.dispatch({ effects: EditorView.scrollIntoView(m.from, { y: 'center' }) })
}

const {
  open: searchOpen, count: matchCount, index: searchIdx, query: searchQuery,
  setOpen, setQuery, next: onNext, prev: onPrev, close: onClose,
} = useResultSearch({
  getMatches: () => matchRanges.value,
  onActivate: refresh,   // next/prev: move the active mark + scroll
  onApply:    refresh,   // query settled: re-scan highlight (or clear when empty)
  debounce:   150,       // coalesce keystrokes before the (expensive) full-document scan
  resetOn:    () => props.results,
})

const matchRanges = computed(() => {
  const q = searchQuery.value
  if (!q) return []
  const view = cmRef.value?.getView()
  if (!view) return []
  const doc  = view.state.doc
  const needle = q.toLowerCase()
  const out = []
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const lower = line.text.toLowerCase()
    let start = 0
    while (start < lower.length) {
      const pos = lower.indexOf(needle, start)
      if (pos === -1) break
      out.push({ from: line.from + pos, to: line.from + pos + q.length })
      start = pos + 1
    }
  }
  return out
})
</script>

<template>
  <div ref="viewRef" class="json-view">
    <div v-if="!results?.length" class="json-empty">No documents</div>
    <template v-else>
      <SearchBar
        :open="searchOpen"
        :count="matchCount"
        :current="searchIdx"
        :scope="viewRef"
        @update:open="setOpen"
        @update:query="setQuery"
        @next="onNext"
        @prev="onPrev"
        @close="onClose"
      />
      <CodeEditor ref="cmRef" class="json-cm" :model-value="text" readonly highlight="json" :extensions="jsonExtensions" />
    </template>
  </div>
</template>

<style scoped>
.json-view { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; position: relative; }
.json-cm { flex: 1; min-height: 0; overflow: hidden; }
.json-empty { padding: 32px; color: var(--text-faint); font-size: 12px; }
</style>

<style>
.cm-search-match { background: var(--search-hit); border-radius: 2px; }
.cm-search-match-selected { background: var(--search-active); border-radius: 2px; }
</style>
