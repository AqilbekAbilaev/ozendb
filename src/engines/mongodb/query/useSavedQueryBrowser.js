import { ref, watch } from 'vue'
import { workspaceIsCollection } from '../../../workspaces/registry'
import { savedQueryBrowserRequest } from '../../../stores/menuRequests'
import { tabs, activeTab, activateTab } from '../../../stores/tabs'

// Module-level, not per pane: the browser stays open while the user switches tabs, and
// the collection pane it was opened from unmounts meanwhile. The chosen query still goes
// to that tab, as `request`, which its pane applies and acknowledges once it is back.
const isOpen = ref(false)
const targetTabId = ref(null)
const request = ref(null)
let nonce = 0

function open(tab) {
  if (!workspaceIsCollection(tab)) return
  targetTabId.value = tab.id
  isOpen.value = true
}

function close() {
  isOpen.value = false
  targetTabId.value = null
}

function apply(entry) {
  const tabId = targetTabId.value
  if (!tabId) return
  request.value = { nonce: ++nonce, tabId, entry }
  isOpen.value = false
  targetTabId.value = null
  activateTab(tabId)
}

function acknowledge(requestNonce) {
  if (request.value?.nonce === requestNonce) request.value = null
}

function retainTargets(ids) {
  if (targetTabId.value && !ids.has(targetTabId.value)) close()
  if (request.value && !ids.has(request.value.tabId)) request.value = null
}

export function useSavedQueryBrowser() {
  return { isOpen, targetTabId, request, open, close, apply, acknowledge, retainTargets }
}

// File → Load opens the browser on the active tab, and closing a tab drops it as a
// target. Called once, by the always-mounted dialog.
export function watchSavedQueryBrowserTriggers() {
  watch(() => savedQueryBrowserRequest.value?.nonce, (requestNonce) => {
    if (requestNonce != null) open(activeTab.value)
  })
  watch(() => tabs.value.map(tab => tab.id), (ids) => {
    retainTargets(new Set(ids))
  })
}
