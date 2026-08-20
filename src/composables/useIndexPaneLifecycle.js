import { ref } from 'vue'

function targetOf(tab) {
  return {
    connectionId: tab.connId,
    database: tab.dbName,
    collection: tab.collName,
  }
}

function sameTarget(left, right) {
  return !!left && !!right
    && left.connectionId === right.connectionId
    && left.database === right.database
    && left.collection === right.collection
}

// Identity-sensitive state for the reused Index Manager pane. Vue keeps one pane
// instance while switching between index tabs, so form targets, menu ownership, and
// async responses must be tied explicitly to the workspace that started them.
export function useIndexPaneLifecycle() {
  const formTarget = ref(null)
  let attachedTab = null
  let formVersion = 0
  let loadVersion = 0

  function attachMenuApi(tab, api) {
    if (attachedTab && attachedTab._idxApi === api) delete attachedTab._idxApi
    attachedTab = tab || null
    if (attachedTab) attachedTab._idxApi = api
    formTarget.value = null
    formVersion++
    loadVersion++
  }

  function detachMenuApi(api) {
    if (attachedTab && attachedTab._idxApi === api) delete attachedTab._idxApi
    attachedTab = null
    formTarget.value = null
    formVersion++
    loadVersion++
  }

  function captureFormTarget(tab) {
    formTarget.value = targetOf(tab)
    formVersion++
    return formTarget.value
  }

  function clearFormTarget() {
    formTarget.value = null
    formVersion++
  }

  function beginFormSubmit() {
    if (!formTarget.value) return null
    return { version: ++formVersion, target: formTarget.value }
  }

  function isCurrentFormSubmit(submission, tab) {
    return !!submission
      && submission.version === formVersion
      && isTargetActive(submission.target, tab)
  }

  function isTargetActive(target, tab) {
    return !!tab && sameTarget(target, targetOf(tab))
  }

  function beginLoad(tab) {
    return { version: ++loadVersion, target: targetOf(tab) }
  }

  function isCurrentLoad(request, tab) {
    return !!request && request.version === loadVersion && isTargetActive(request.target, tab)
  }

  return {
    formTarget,
    targetForTab: targetOf,
    attachMenuApi,
    detachMenuApi,
    captureFormTarget,
    clearFormTarget,
    beginFormSubmit,
    isCurrentFormSubmit,
    isTargetActive,
    beginLoad,
    isCurrentLoad,
  }
}
