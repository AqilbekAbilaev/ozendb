import { ref, computed } from 'vue'
import { createWorkspace } from '../workspaces/createWorkspace'
import { duplicateWorkspace, disposeWorkspace } from '../workspaces/lifecycle'

// These used to live in App.vue, threaded through six composables. Nothing here may call
// createWorkspace at module scope — a cold import beats main.js to populating the registry.
export const tabs = ref([])
export const activeTabId = ref(null)

// Safe only after registerWorkspaceDefinitions(); tests importing this store register first.
let tabsInitialized = false
export function initializeTabs() {
  if (tabsInitialized) return
  tabsInitialized = true
  const tab = createWorkspace('app.quickstart', { ids: { workspace: () => 't0' } })
  tabs.value.push(tab)
  activeTabId.value = tab.id
}

// Was `'t' + Date.now()` per call site, which collides within a millisecond — and a
// duplicate id silently breaks closeTab/activateTab, which act on the first match.
export function newTabId() {
  return crypto.randomUUID()
}

export const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value))

// Bulk deletes (dropping a database closes every tab under it) can strand the active id.
export function pruneActiveTab() {
  if (activeTabId.value && !tabs.value.find(t => t.id === activeTabId.value)) {
    activeTabId.value = tabs.value.length ? tabs.value[tabs.value.length - 1].id : null
  }
}

export const renameTabTarget = ref(null)
export const renameTabValue = ref('')

export function activateTab(id) {
  if (!tabs.value.some(t => t.id === id)) return
  activeTabId.value = id
}

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

export function closeTab(id, activateFallback = true) {
  const idx = tabs.value.findIndex(t => t.id === id)
  if (idx < 0) return
  const closing = tabs.value[idx]
  // Disposal is definition-owned and best-effort: the helper contains any failure,
  // and the splice below never waits on it — visual closure stays synchronous.
  disposeWorkspace(closing)
  tabs.value.splice(idx, 1)
  if (activateFallback && activeTabId.value === id) {
    const next = tabs.value[idx - 1] || tabs.value[0]
    if (next) activateTab(next.id)
    else activeTabId.value = null
  }
}

function closeTabs(ids) {
  const victims = new Set(ids)
  const original = [...tabs.value]
  const activeIndex = original.findIndex(t => t.id === activeTabId.value)
  const activeClosing = activeIndex >= 0 && victims.has(activeTabId.value)

  for (const id of victims) closeTab(id, false)
  if (!activeClosing) return

  const previous = original.slice(0, activeIndex).reverse().find(t => !victims.has(t.id))
  const next = previous || original.find(t => !victims.has(t.id))
  if (next) activateTab(next.id)
  else activeTabId.value = null
}

// These all map to ids first: closeTab splices, so iterating the live array would skip.
export function closeWhere(predicate) {
  closeTabs(tabs.value.filter(t => predicate(t)).map(t => t.id))
}

export function closeTabsExcept(tabId) {
  closeTabs(tabs.value.filter(t => t.id !== tabId).map(t => t.id))
}
export function closeTabsToSide(tabId, side) {
  const idx = tabs.value.findIndex(t => t.id === tabId)
  if (idx < 0) return
  const victims = side === 'left' ? tabs.value.slice(0, idx) : tabs.value.slice(idx + 1)
  closeTabs(victims.map(t => t.id))
}
export function closeAllTabs() {
  closeTabs(tabs.value.map(t => t.id))
}
export function moveTabToFront(tabId) {
  const idx = tabs.value.findIndex(t => t.id === tabId)
  if (idx <= 0) return
  const [tab] = tabs.value.splice(idx, 1)
  tabs.value.unshift(tab)
}
// Order is the array itself, so session persistence saves the drag for free.
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
  const dup = duplicateWorkspace(src)
  if (!dup) return   // unsupported duplicate (e.g. Quickstart) is a no-op
  tabs.value.push(dup)
  activateTab(dup.id)
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
