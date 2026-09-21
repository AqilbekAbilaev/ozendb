<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { isEditingTarget } from '../../utils/editingTarget'
import BaseIcon from './BaseIcon.vue'

// Shared search bar for Table, JSON, and Tree result views.
// Pure UI — the parent owns match-finding, scrolling, and highlighting.
const props = defineProps({
  open:    { type: Boolean, default: false },
  count:   { type: Number,  default: 0 },
  current: { type: Number,  default: -1 },
  // The results container element. When focus is inside another editor (the query
  // editor, some field) we bail — but an editor *inside* our own view (the JSON code
  // view) must still trigger search. Passing that element lets us tell them apart.
  scope:   { default: null },
})

const emit = defineEmits(['update:open', 'update:query', 'next', 'prev', 'close'])

const query = ref('')
const input = ref(null)

const label = computed(() => {
  if (!props.open) return ''
  if (!props.count) return 'No results'
  return `${props.current + 1} of ${props.count}`
})

function openBar()   { emit('update:open', true); nextTick(() => { if (input.value) input.value.focus() }) }
function closeBar()  { query.value = ''; emit('update:open', false); emit('close') }
function nextMatch()   { emit('next') }
function prevMatch()   { emit('prev') }

watch(query, (q) => emit('update:query', q))

function onKeydown(e) {
  const t = e.target
  const isSearchInput = t === input.value

  // Bail if focus is inside an editor/field the app owns — unless that editor lives
  // inside our own results view (e.g. the JSON code view), where search must still work.
  if (isEditingTarget(t) && !(props.scope && props.scope.contains(t))) return

  // Ctrl/Cmd+F — open
  if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault()
    openBar()
    return
  }

  // When search bar is open and focus is NOT in the search input (e.g. in CodeMirror or the grid)
  if (props.open && !isSearchInput) {
    if (e.key === 'Escape') { e.preventDefault(); closeBar(); return }
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? prevMatch() : nextMatch(); return }
  }
}

onMounted(()  => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

defineExpose({ open: openBar, focus: () => nextTick(() => input.value?.focus()) })
</script>

<template>
  <div v-if="open" class="search-bar">
    <BaseIcon name="search" :size="13" class="search-icon" />
    <input
      ref="input"
      v-model="query"
      class="search-input"
      placeholder="Find in results…"
      @keydown.enter.prevent="$event.shiftKey ? prevMatch() : nextMatch()"
      @keydown.escape.prevent="closeBar"
    />
    <span class="search-count" :class="{ empty: !count }">{{ label }}</span>
    <button class="search-nav" title="Previous match (Shift+Enter)" @click="prevMatch">
      <BaseIcon name="caret" :size="11" class="search-nav-icon" />
    </button>
    <button class="search-nav" title="Next match (Enter)" @click="nextMatch">
      <BaseIcon name="caretDown" :size="11" class="search-nav-icon" />
    </button>
    <button class="search-close" title="Close (Escape)" @click="closeBar">
      <BaseIcon name="close" :size="12" />
    </button>
  </div>
</template>

<style scoped>
.search-bar {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-panel-2);
  border: 1px solid var(--border);
  border-top: none;
  border-right: none;
  border-radius: 0 0 0 8px;
  padding: 5px 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, .35);
}
.search-icon { color: var(--text-faint); flex: none; }
.search-input {
  width: 180px;
  background: var(--bg-input);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 7px;
  font-size: 12px;
  outline: none;
  font-family: inherit;
}
.search-input:focus { border-color: var(--accent); }
.search-count {
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
  min-width: 48px;
  text-align: center;
}
.search-count.empty { color: var(--text-faint); }
.search-nav {
  background: none;
  border: 1px solid var(--border-soft);
  color: var(--text-dim);
  border-radius: 4px;
  padding: 2px 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.search-nav:hover { background: var(--bg-hover); color: var(--text); }
.search-nav-icon { display: block; }
.search-close {
  background: none;
  border: none;
  color: var(--text-faint);
  padding: 2px;
  cursor: pointer;
  display: flex;
  align-items: center;
}
.search-close:hover { color: var(--text); }
</style>
