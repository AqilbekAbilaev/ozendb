import { ref, computed } from 'vue'
import { invoke } from '@tauri-apps/api/core'

// The tab spine: the open workspace tabs, which one is active, and every mutation of
// them (activate/close/cycle/duplicate/reorder/rename).
//
// Module-scope refs, so every importer shares one instance — that's the point. These
// used to live in App.vue and be passed into six composables, which meant tracing a tab
// mutation required reading all seven files.
//
// Exported as refs (not a reactive object) so consumers still awaiting migration can be
// handed them as the `{ tabs, activeTabId }` params they already expect.
//
// The workspace always keeps at least one tab open; App.vue watches the length and
// reopens Quickstart at zero, since the tab creators still live there.
export const tabs = ref([
  { id: 't0', kind: 'quickstart', title: 'Quickstart' }
])
export const activeTabId = ref('t0')

// `tabs.value.find(t => t.id === activeTabId.value)` was written out at ~a dozen call
// sites across App.vue and three composables. Undefined when no tab is open.
export const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value))

// Several callers delete tabs in bulk (dropping a database or collection closes every
// tab pointing at it) and then need the active id to still refer to something. Falls
// back to the last remaining tab, or none.
export function pruneActiveTab() {
  if (activeTabId.value && !tabs.value.find(t => t.id === activeTabId.value)) {
    activeTabId.value = tabs.value.length ? tabs.value[tabs.value.length - 1].id : null
  }
}

// Re-running a restored tab's saved query belongs to the query runner, which is a
// composable needing app-level deps (showToast) this module can't reach. App.vue
// registers it once during setup, so the store depends on a function rather than on
// useQueryRunner itself.
let runRestoredTab = () => {}
export function setRunRestoredTab(fn) { runRestoredTab = fn }

// ── rename tab dialog ──
export const renameTabTarget = ref(null)   // id of the tab being renamed
export const renameTabValue = ref('')

export function activateTab(id) {
  activeTabId.value = id
  const tab = tabs.value.find(t => t.id === id)
  if (tab && tab._restored) runRestoredTab(tab)
}

// Move the active-tab selection by `delta` (+1 next, -1 previous), wrapping around.
// No-ops when fewer than two tabs are open.
export function cycleTab(delta) {
  if (tabs.value.length < 2) return
  const idx = tabs.value.findIndex(t => t.id === activeTabId.value)
  if (idx < 0) {
    activateTab(tabs.value[0].id)
    return
  }
  const next = (idx + delta + tabs.value.length) % tabs.value.length
  activateTab(tabs.value[next].id)
}

export function closeTab(id) {
  const idx = tabs.value.findIndex(t => t.id === id)
  if (idx < 0) return
  const closing = tabs.value[idx]
  if (closing.kind === 'shell' && closing.sessionId) {
    invoke('close_shell_session', { sessionId: closing.sessionId }).catch(() => {})
  }
  tabs.value.splice(idx, 1)
  // If we closed the active tab, move to an adjacent one (the nearest preceding
  // tab, else the new first tab).
  if (activeTabId.value === id) {
    const next = tabs.value[idx - 1] || tabs.value[0]
    activeTabId.value = next ? next.id : null
  }
}

// filter/slice below hand back a fresh array, so closeTab's splicing can't shift the
// iteration out from under these.
export function closeTabsExcept(tabId) {
  tabs.value.filter(t => t.id !== tabId).map(t => t.id).forEach(closeTab)
}
export function closeTabsToSide(tabId, side) {
  const idx = tabs.value.findIndex(t => t.id === tabId)
  if (idx < 0) return
  const victims = side === 'left' ? tabs.value.slice(0, idx) : tabs.value.slice(idx + 1)
  victims.map(t => t.id).forEach(closeTab)
}
export function closeAllTabs() {
  tabs.value.map(t => t.id).forEach(closeTab)
}
export function moveTabToFront(tabId) {
  const idx = tabs.value.findIndex(t => t.id === tabId)
  if (idx <= 0) return
  const [tab] = tabs.value.splice(idx, 1)
  tabs.value.unshift(tab)
}
// Reorder: move `id` to sit before `beforeId` (null = to the end). Driven by the tab-strip
// drag. The new order is the tab array itself, so session persistence saves it for free.
export function moveTab(id, beforeId) {
  if (id === beforeId) return
  const from = tabs.value.findIndex(t => t.id === id)
  if (from < 0) return
  const [tab] = tabs.value.splice(from, 1)
  let to = beforeId == null ? tabs.value.length : tabs.value.findIndex(t => t.id === beforeId)
  if (to < 0) to = tabs.value.length
  tabs.value.splice(to, 0, tab)
}
export function duplicateTab(tabId) {
  const src = tabs.value.find(t => t.id === tabId)
  if (!src) return
  const id = 't' + Date.now()
  if (src.kind === 'shell') {
    tabs.value.push({
      id: id, kind: 'shell', title: src.title,
      connectionId: src.connectionId, connectionName: src.connectionName,
      dbName: src.dbName,
      sessionId: (crypto.randomUUID ? crypto.randomUUID() : id),
      code: src.code || '', history: [], isRunning: false,
      results: [], resultView: 'table', resultTab: 'Console',
      runError: null, elapsedMs: null, drillPath: [], hasRun: false, selectedRow: -1, selectedRows: [],
      logs: [], scalar: undefined, hasScalar: false,
      color: src.color ?? null,
    })
    activeTabId.value = id
    return
  }
  const dup = {
    id: id, kind: 'collection', title: src.title,
    connectionId: src.connectionId, connectionName: src.connectionName,
    dbName: src.dbName, collectionName: src.collectionName,
    filter: src.filter, projection: src.projection, sort: src.sort,
    skip: src.skip, limit: src.limit, mode: src.mode, pipeline: src.pipeline,
    color: src.color ?? null,
    colOrder: src.colOrder || {},
    results: [], hasRun: false, isRunning: false, runError: null,
    selectedRow: -1, selectedRows: [], elapsedMs: null,
  }
  tabs.value.push(dup)
  activeTabId.value = id
  runRestoredTab(dup)   // re-run from the cloned query state (find mode only)
}

export function openRenameTab(tabId) {
  const tab = tabs.value.find(t => t.id === tabId)
  if (!tab) return
  renameTabTarget.value = tabId
  renameTabValue.value = tab.title || ''
}
export function confirmRenameTab() {
  const tab = tabs.value.find(t => t.id === renameTabTarget.value)
  const name = renameTabValue.value.trim()
  if (tab && name) tab.title = name
  renameTabTarget.value = null
}

export function handleTabAction(action, tabId) {
  if (action.startsWith('Choose Color:')) {
    const color = action.split(':')[1]
    const tab = tabs.value.find(t => t.id === tabId)
    if (tab) tab.color = color === 'none' ? null : color
    return
  }
  switch (action) {
    case 'Close Tab':               closeTab(tabId); break
    case 'Close Other Tabs':        closeTabsExcept(tabId); break
    case 'Close Tabs to the Left':  closeTabsToSide(tabId, 'left'); break
    case 'Close Tabs to the Right': closeTabsToSide(tabId, 'right'); break
    case 'Close All Tabs':          closeAllTabs(); break
    case 'Duplicate Tab':           duplicateTab(tabId); break
    case 'Move Tab to the Front':   moveTabToFront(tabId); break
    case 'Rename Tab…':             openRenameTab(tabId); break
  }
}
