<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import BaseIcon from './BaseIcon.vue'
import { colorHex, tabColorName } from '../../utils/tabColor.js'
import { findDropIndex } from '../../composables/useColumnReorder'

const props = defineProps({
  tabs:         { type: Array,  required: true },
  activeTabId:  { type: String, required: true },
  // Colour tags for tree nodes (keyed by connId / connId/db / connId/db/coll).
  // A tab with no colour of its own inherits the colour of the node it opened.
  tagOverrides: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['activate-tab', 'close-tab', 'reorder-tab', 'tab-context'])

// The colour name shown on a tab, resolved (with inheritance) by the shared util.
function tabColor(t) {
  return tabColorName(t, props.tagOverrides)
}

// Overflow handling: tabs keep their natural (content) width, so we measure each
// rendered tab and cache its width by id. The cache stays valid because a tab is
// always rendered (and measured) when it's the active tab — and newly opened
// tabs are always active — so a tab that later collapses into the overflow was
// measured while it was visible.
const OVERFLOW_W = 52   // space reserved for the "+N" button
const FALLBACK_W = 150  // assumed width for a tab not yet measured

const barEl = ref(null)
const barWidth = ref(0)
const measureTick = ref(0)
const widths = new Map()  // tabId → measured px (non-reactive; measureTick drives recompute)

let resizeObserver = null

function measure() {
  if (!barEl.value) return
  let changed = false
  barEl.value.querySelectorAll('.tab').forEach((el) => {
    const id = el.dataset.id
    const w = el.offsetWidth
    if (id && w && widths.get(id) !== w) {
      widths.set(id, w)
      changed = true
    }
  })
  if (changed) measureTick.value++
}

onMounted(() => {
  // Measure first — at this point barWidth is still 0, so every tab is rendered
  // and measurable; then switch on width-based layout.
  measure()
  if (barEl.value) {
    barWidth.value = barEl.value.clientWidth
    resizeObserver = new ResizeObserver((entries) => {
      barWidth.value = entries[0].contentRect.width
    })
    resizeObserver.observe(barEl.value)
  }
})
onUnmounted(() => {
  if (resizeObserver) resizeObserver.disconnect()
})

// Re-measure after the tab set changes (open/close/rename/recolor). Uses the
// effective colour (tab's own or inherited from its node) so a dot appearing or
// disappearing on a node recolour re-triggers measurement.
watch(
  () => props.tabs.map((t) => t.id + '|' + (t.title || '') + '|' + (tabColor(t) || '')).join('~'),
  () => nextTick(measure),
)

const widthOf = (t) => widths.get(t.id) ?? FALLBACK_W

// Split into rendered tabs + tabs collapsed into the overflow menu. The active
// tab is always kept visible (taking the last visible slot if needed), so a
// freshly opened tab never vanishes into the overflow.
const layout = computed(() => {
  void measureTick.value // recompute when measurements change
  const all = props.tabs
  const total = all.length
  if (!barWidth.value || total === 0) {
    return { visible: all, hidden: [] }
  }

  // Does everything fit without an overflow button?
  let sum = 0
  let fitsAll = true
  for (const t of all) {
    sum += widthOf(t)
    if (sum > barWidth.value) { fitsAll = false; break }
  }
  if (fitsAll) {
    return { visible: all, hidden: [] }
  }

  // Otherwise reserve room for the button and fit as many as we can.
  const budget = barWidth.value - OVERFLOW_W
  let used = 0
  let cutoff = 0
  for (const t of all) {
    if (used + widthOf(t) <= budget) { used += widthOf(t); cutoff++ } else break
  }
  if (cutoff < 1) cutoff = 1

  const activeIdx = all.findIndex((t) => t.id === props.activeTabId)
  let visible
  if (activeIdx >= 0 && activeIdx >= cutoff) {
    visible = all.slice(0, Math.max(0, cutoff - 1)).concat([all[activeIdx]])
  } else {
    visible = all.slice(0, cutoff)
  }
  const visibleIds = new Set(visible.map((t) => t.id))
  const hidden = all.filter((t) => !visibleIds.has(t.id))
  return { visible: visible, hidden: hidden }
})

// Overflow dropdown: rendered to <body> with fixed coords so the strip's
// `overflow: hidden` can't clip it.
const showOverflow = ref(false)
const ovStyle = ref({})
function toggleOverflow(e) {
  if (showOverflow.value) {
    showOverflow.value = false
    return
  }
  const rect = e.currentTarget.getBoundingClientRect()
  ovStyle.value = {
    top: rect.bottom + 'px',
    right: (window.innerWidth - rect.right) + 'px',
  }
  showOverflow.value = true
}
function pickHidden(id) {
  showOverflow.value = false
  emit('activate-tab', id)
}

// ── drag a tab to reorder ───────────────────────────────
// Raw mouse events (like the grid's drag) so a plain click still activates: a drag only
// begins past a small threshold, an accent line marks the drop slot, and on release we emit
// `reorder-tab(id, beforeId)` (beforeId null = drop at the end). Reordering is confined to the
// visible tabs; ones collapsed into the overflow menu aren't drop targets.
const DRAG_THRESHOLD = 5
const dragId       = ref(null)   // id of the tab being dragged (null = not dragging)
const dragging     = ref(false)  // past the threshold
const dropBeforeId = ref(null)   // insert before this visible tab (null = at the end)
let dragStartX = 0
let dragStartY = 0
let suppressClick = false

const lastVisibleId = computed(() => {
  const vis = layout.value.visible
  return vis.length ? vis[vis.length - 1].id : null
})

function visibleTabRects() {
  if (!barEl.value) return []
  const out = []
  layout.value.visible.forEach((t, i) => {
    const el = barEl.value.querySelector(`.tab[data-id="${t.id}"]`)
    if (el) out.push({ index: i, rect: el.getBoundingClientRect() })
  })
  return out
}

function onTabMouseDown(e, t) {
  if (e.button !== 0) return
  if (e.target.closest('.x')) return  // the close button owns this press
  dragStartX = e.clientX
  dragStartY = e.clientY
  dragId.value = t.id
  dragging.value = false
  // Clear any suppression stranded by a prior cross-tab drag (whose trailing click landed on
  // the strip, not a tab, so it never got consumed) before this gesture's own click.
  suppressClick = false
  document.addEventListener('mousemove', onTabMove)
  document.addEventListener('mouseup', onTabUp)
}

function onTabMove(e) {
  if (!dragging.value) {
    if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) < DRAG_THRESHOLD) return
    dragging.value = true
    document.body.style.cursor = 'grabbing'
  }
  const vis = layout.value.visible
  const idx = findDropIndex(e.clientX, visibleTabRects())  // 0..vis.length
  dropBeforeId.value = idx >= 0 && idx < vis.length ? vis[idx].id : null
}

function onTabUp() {
  document.removeEventListener('mousemove', onTabMove)
  document.removeEventListener('mouseup', onTabUp)
  document.body.style.cursor = ''
  if (dragging.value && dragId.value) {
    emit('reorder-tab', dragId.value, dropBeforeId.value)
    suppressClick = true  // swallow the click that trails a real drag
  }
  dragId.value = null
  dragging.value = false
  dropBeforeId.value = null
}

function onTabClick(t) {
  if (suppressClick) { suppressClick = false; return }
  emit('activate-tab', t.id)
}

// The workspace always keeps one tab open, so the lone Quickstart tab has no ✕ — and
// middle-click must honour the same rule rather than being a second way to empty the strip.
function closable(t) {
  return props.tabs.length > 1 || t.kind !== 'quickstart'
}

// Middle-click closes a tab, as in a browser's tab strip. Drag ignores non-left buttons
// already (see onTabMouseDown), so this can't collide with a reorder.
function onTabAuxClick(t) {
  if (closable(t)) emit('close-tab', t.id)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onTabMove)
  document.removeEventListener('mouseup', onTabUp)
  document.body.style.cursor = ''
})
</script>

<template>
  <div class="tabs" ref="barEl">
    <button
      v-for="t in layout.visible"
      :key="t.id"
      :data-id="t.id"
      class="tab"
      :class="{
        active: t.id === activeTabId,
        dragsrc: dragging && dragId === t.id,
        dropbefore: dragging && dropBeforeId === t.id,
        dropafter: dragging && dropBeforeId === null && t.id === lastVisibleId,
      }"
      @mousedown="onTabMouseDown($event, t)"
      @click="onTabClick(t)"
      @auxclick.middle.prevent="onTabAuxClick(t)"
      @contextmenu.prevent="emit('tab-context', { id: t.id, x: $event.clientX, y: $event.clientY })"
    >
      <span v-if="colorHex(tabColor(t))" class="dot" :style="{ background: colorHex(tabColor(t)) }"></span>
      <span class="title">{{ t.title }}</span>
      <span v-if="closable(t)" class="x" @click.stop="emit('close-tab', t.id)">
        <BaseIcon name="close" :size="12" />
      </span>
    </button>

    <button
      v-if="layout.hidden.length"
      class="ov-btn"
      :class="{ open: showOverflow }"
      @click="toggleOverflow"
    >
      +{{ layout.hidden.length }}
      <BaseIcon name="caretDown" :size="11" />
    </button>
  </div>

  <Teleport to="body">
    <template v-if="showOverflow">
      <div class="ov-backdrop" @click="showOverflow = false"></div>
      <div class="ov-menu" :style="ovStyle">
        <div
          v-for="t in layout.hidden"
          :key="t.id"
          class="ov-item"
          :class="{ active: t.id === activeTabId }"
          @click="pickHidden(t.id)"
        >
          <span v-if="colorHex(tabColor(t))" class="dot" :style="{ background: colorHex(tabColor(t)) }"></span>
          <span class="ov-label">{{ t.title }}</span>
        </div>
      </div>
    </template>
  </Teleport>
</template>

<style scoped>
.tabs {
  display: flex;
  align-items: stretch;
  background: var(--bg-panel-2);
  border-bottom: 1px solid var(--border);
  height: 32px;
  flex: none;
  padding-left: 6px;
  overflow: hidden;
}
.tab {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 12px;
  font-size: 12.5px;
  color: var(--text-dim);
  border-right: 1px solid var(--border);
  border-top: none;
  border-bottom: 2px solid transparent;
  border-left: none;
  background: none;
  box-sizing: border-box;
  max-width: 220px;
  flex: none;
}
.tab.active { background: var(--bg-window); color: var(--text); border-bottom-color: var(--accent); }
/* Reorder feedback: the dragged tab dims, an accent line marks the slot it will drop into. */
.tab.dragsrc { opacity: .45; }
.tab.dropbefore { box-shadow: inset 2px 0 0 var(--accent); }
.tab.dropafter  { box-shadow: inset -2px 0 0 var(--accent); }
.tab .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.tab .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.tab .x { color: var(--text-faint); border-radius: 4px; padding: 1px; display: grid; place-items: center; flex: none; }
.tab .x:hover { background: var(--bg-hover); color: var(--text); }

.ov-btn {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 0 10px;
  font-size: 12px;
  color: var(--text-dim);
  background: none;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  flex: none;
}
.ov-btn:hover, .ov-btn.open { background: var(--bg-hover); color: var(--text); }
</style>

<style>
/* Unscoped: the overflow menu is teleported to <body>, outside this component. */
.ov-backdrop { position: fixed; inset: 0; z-index: 80; }
.ov-menu {
  position: fixed;
  z-index: 81;
  min-width: 200px;
  max-height: 60vh;
  overflow-y: auto;
  background: var(--bg-menu);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 18px 48px rgba(0,0,0,.6);
  padding: 5px;
}
.ov-menu .ov-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 12px 6px 10px;
  border-radius: 5px;
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
  cursor: default;
}
.ov-menu .ov-item:hover { background: var(--accent); color: #fff; }
.ov-menu .ov-item.active { font-weight: 600; }
.ov-menu .ov-item .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.ov-menu .ov-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
</style>
