import { ref } from 'vue'

export function useSavedQueryBrowser({ activate }) {
  const isOpen = ref(false)
  const targetTabId = ref(null)
  const request = ref(null)
  let nonce = 0

  function open(tab) {
    if (!tab || tab.kind !== 'collection') return
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
    activate(tabId)
  }

  function acknowledge(requestNonce) {
    if (request.value?.nonce === requestNonce) request.value = null
  }

  function retainTargets(ids) {
    if (targetTabId.value && !ids.has(targetTabId.value)) close()
    if (request.value && !ids.has(request.value.tabId)) request.value = null
  }

  return { isOpen, targetTabId, request, open, close, apply, acknowledge, retainTargets }
}
