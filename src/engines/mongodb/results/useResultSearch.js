import { ref, computed, watch, onBeforeUnmount } from 'vue'

// Shared "find in results" state for the Table and JSON result views. The view owns
// *what* a match is (how it scans the data) and *how* to reveal one (highlight + scroll);
// this composable owns the bar's open/close, the debounce, the active-match index and the
// next/prev wrapping — the parts both views had duplicated.
//
//   getMatches  () => Match[]           current matches; must read `query` so it stays reactive
//   onActivate  (match, index) => void  reveal the active match (scroll / move highlight)
//   onApply     () => void              runs once the query settles (re-highlight or clear)
//   debounce    number                  ms to coalesce keystrokes before scanning (0 = immediate)
//   resetOn     () => any               watched source; clears the search when it changes
export function useResultSearch({ getMatches, onActivate, onApply, debounce = 0, resetOn } = {}) {
  const open  = ref(false)
  const query = ref('')   // the (debounced) text the view scans against
  const index = ref(-1)   // active match, 0-based; -1 = none
  let timer = null

  const count = computed(() => getMatches().length)

  function apply(q) {
    query.value = q
    index.value = count.value ? 0 : -1
    if (onApply) onApply()
  }

  function setQuery(q) {
    clearTimeout(timer)
    // Empty query clears immediately; a real query is debounced so a common letter
    // matching thousands of spots doesn't rescan on every keystroke.
    if (!q || debounce <= 0) apply(q)
    else timer = setTimeout(() => apply(q), debounce)
  }

  function activate() {
    if (onActivate) onActivate(getMatches()[index.value], index.value)
  }

  function next() {
    if (!count.value) return
    index.value = (index.value + 1) % count.value
    activate()
  }

  function prev() {
    if (!count.value) return
    index.value = (index.value - 1 + count.value) % count.value
    activate()
  }

  function reset() {
    clearTimeout(timer)
    query.value = ''
    index.value = -1
    if (onApply) onApply()
  }

  function setOpen(v) {
    open.value = v
    if (!v) reset()
  }

  function close() {
    open.value = false
    reset()
  }

  if (resetOn) watch(resetOn, () => { if (open.value) reset() })

  onBeforeUnmount(() => clearTimeout(timer))

  return { open, query, index, count, setOpen, setQuery, next, prev, close }
}
