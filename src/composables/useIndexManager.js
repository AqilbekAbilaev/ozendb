import { computed, ref, watch } from 'vue'
import * as idx from '../stores/indexes'
import { createIndex, dropIndex, indexStats, listIndexes, setIndexHidden } from '../engines/mongodb/api/indexes'
import { collectionStats } from '../engines/mongodb/api/admin'
import {
  isProtectedIndex, isIndexHidden, indexType, indexProperties, requestedIndexHidden,
  indexSizesFrom, indexUsageFrom, indexSeedFromClipboard,
} from '../utils/indexSpec'
import { errText, errMessage } from '../utils/errors'
import { fmtBytes } from '../utils/format'
import { useIndexPaneLifecycle } from './useIndexPaneLifecycle'
import { showToast } from '../stores/toast'
import { refreshRequest, indexMenuRequest } from '../stores/menuRequests'

// One Index Manager tab's list, selection, metrics and create/edit form, behind
// IndexManagerPane. Two tabs for different collections never share any of it; the shared
// stores/indexes is only used for the app-level modals (View Details, Drop Index) and
// for what the native Index menu sees. `activeTab` is a getter: Vue reuses one pane
// across Index Manager tabs. Call `release()` when the pane unmounts.
export function useIndexManager(activeTab) {
  // Per-tab state (not shared across tabs)
  const localIndexesList     = ref([])
  const localIndexesLoading  = ref(false)
  const localIndexesError    = ref(null)
  const localSelectedIndex   = ref(null)
  const localIndexSizes      = ref({})
  const localIndexUsage      = ref({})
  const localIndexUsageError = ref(null)
  const localIndexTotalSize  = ref(null)
  const localIndexFormOpen   = ref(false)
  const localIndexFormMode   = ref('create')
  const localIndexFormSeed   = ref(null)
  const localIndexCreating   = ref(false)
  const localExpanded        = ref({})
  const lifecycle = useIndexPaneLifecycle()

  async function loadIndexes(tab = activeTab()) {
    const request = lifecycle.beginLoad(tab)
    localIndexesLoading.value = true
    localIndexesError.value = null
    try {
      const indexes = await listIndexes(request.target)
      if (!lifecycle.isCurrentLoad(request, activeTab())) return
      localIndexesList.value = indexes
    } catch (e) {
      if (!lifecycle.isCurrentLoad(request, activeTab())) return
      localIndexesError.value = errText(e)
      localIndexesList.value = []
    } finally {
      if (lifecycle.isCurrentLoad(request, activeTab())) localIndexesLoading.value = false
    }
    await loadIndexMetrics(request)
  }

  async function loadIndexMetrics(request) {
    try {
      const stats = await collectionStats(request.target)
      if (!lifecycle.isCurrentLoad(request, activeTab())) return
      const { sizes, total } = indexSizesFrom(stats)
      localIndexSizes.value = sizes
      localIndexTotalSize.value = total
    } catch (e) {
      if (!lifecycle.isCurrentLoad(request, activeTab())) return
      localIndexSizes.value = {}
      localIndexTotalSize.value = null
    }
    try {
      const stats = await indexStats(request.target)
      if (!lifecycle.isCurrentLoad(request, activeTab())) return
      localIndexUsage.value = indexUsageFrom(stats)
      localIndexUsageError.value = null
    } catch (e) {
      if (!lifecycle.isCurrentLoad(request, activeTab())) return
      localIndexUsage.value = {}
      localIndexUsageError.value = errMessage(e)
    }
  }

  // --- toolbar enablement ---
  const hasSel      = computed(() => !!localSelectedIndex.value)
  const selProtected = computed(() => !!localSelectedIndex.value && isProtectedIndex(localSelectedIndex.value.name))
  const selHidden   = computed(() => !!localSelectedIndex.value && isIndexHidden(localSelectedIndex.value))

  function selectRow(index) {
    localSelectedIndex.value = index
    // Sync to the shared composable so the native Index menu sees the selection
    idx.selectedIndex.value = index
  }

  // Toolbar actions that modify the index list (create, drop, hide) use local
  // invoke calls so they stay scoped to this tab. Actions that open a modal
  // (View Details, Drop Index) delegate to the shared composable since only
  // one modal can be open at a time.

  async function submitIndex({ keys, options }) {
    if (!keys || !keys.trim()) return
    const submission = lifecycle.beginFormSubmit()
    if (!submission) return
    const target = submission.target
    const editing = localIndexFormMode.value === 'edit'
    localIndexCreating.value = true
    localIndexesError.value = null
    try {
      if (editing) {
        await dropIndex(target, localIndexFormSeed.value?.name)
      }
      await createIndex(target, keys, options || '{}')
      if (lifecycle.isCurrentFormSubmit(submission, activeTab())) {
        closeIndexForm()
      }
      if (lifecycle.isTargetActive(target, activeTab())) await loadIndexes(activeTab())
      showToast(editing ? 'Index updated' : 'Index created')
    } catch (e) {
      const message = errText(e)
      if (lifecycle.isCurrentFormSubmit(submission, activeTab())) {
        localIndexesError.value = message
      } else {
        showToast(`${editing ? 'Index update' : 'Index creation'} failed: ${message}`)
      }
    } finally {
      if (lifecycle.isCurrentFormSubmit(submission, activeTab())) {
        localIndexCreating.value = false
      }
    }
  }

  function openCreateIndex(seed) {
    lifecycle.captureFormTarget(activeTab())
    localIndexFormMode.value = 'create'
    localIndexFormSeed.value = seed || null
    localIndexFormOpen.value = true
  }

  function closeIndexForm() {
    localIndexFormOpen.value = false
    localIndexCreating.value = false
    localIndexesError.value = null
    localIndexFormMode.value = 'create'
    localIndexFormSeed.value = null
    lifecycle.clearFormTarget()
  }

  async function toggleHidden(requested) {
    const it = localSelectedIndex.value
    if (!it) return
    const target = lifecycle.targetForTab(activeTab())
    const hidden = requestedIndexHidden(it, requested)
    localIndexesError.value = null
    try {
      await setIndexHidden(target, it.name, hidden)
      if (lifecycle.isTargetActive(target, activeTab())) await loadIndexes(activeTab())
      showToast(hidden ? `Index "${it.name}" hidden` : `Index "${it.name}" unhidden`)
    } catch (e) {
      const message = errText(e)
      if (lifecycle.isTargetActive(target, activeTab())) {
        localIndexesError.value = message
      } else {
        showToast(`Index ${hidden ? 'hide' : 'unhide'} failed: ${message}`)
      }
    }
  }

  // Modal/menu actions: sync selection, then delegate to the shared composable the ones
  // that are app-level modals (View Details, Drop Index, Copy); Edit opens this pane's
  // own dialog instead (the shared composable carries no form state).
  function handleStartEdit() {
    if (selProtected.value) { showToast('The _id index cannot be edited'); return }
    // Edit opens the pane's own dialog (same form the Add button uses), seeded with the
    // selected index — the shared composable carries no form state.
    lifecycle.captureFormTarget(activeTab())
    idx.selectedIndex.value = localSelectedIndex.value
    localIndexFormMode.value = 'edit'
    localIndexFormSeed.value = localSelectedIndex.value
    localIndexFormOpen.value = true
  }

  function handleViewDetails() {
    idx.selectedIndex.value = localSelectedIndex.value
    idx.openIndexDetails()
  }

  function handleDropIndex() {
    if (selProtected.value) { showToast('The _id index cannot be dropped'); return }
    idx.selectedIndex.value = localSelectedIndex.value
    idx.openDropIndexConfirm()
  }

  function handleCopyIndex() {
    idx.selectedIndex.value = localSelectedIndex.value
    idx.copyIndex()
  }

  // What the native Index menu can ask of the open pane (stores/menuRequests). Only the
  // active tab's pane is mounted, so a request always lands on the tab it was made for.
  const menuActions = {
    startEditIndex: handleStartEdit,
    openIndexDetails: handleViewDetails,
    copyIndex: handleCopyIndex,
    openDropIndexConfirm: handleDropIndex,
    setIndexHidden: toggleHidden,
  }
  watch(indexMenuRequest, (request) => { if (request) menuActions[request.method]?.(...request.args) })

  // Vue reuses this pane while switching directly between Index Manager tabs. Reset local
  // UI state and invalidate any async response started by the previous workspace before
  // loading the new target.
  watch(() => activeTab(), (tab) => {
    lifecycle.reset()
    localIndexesList.value = []
    localIndexesError.value = null
    localSelectedIndex.value = null
    localIndexSizes.value = {}
    localIndexUsage.value = {}
    localIndexUsageError.value = null
    localIndexTotalSize.value = null
    localExpanded.value = {}
    closeIndexForm()
    idx.selectedIndex.value = null
    idx.indexesTarget.value = {
      connectionId: tab.connectionId,
      dbName: tab.dbName,
      collectionName: tab.collectionName,
    }
    loadIndexes(tab)
  }, { immediate: true })

  // The pane is going away: forget its rows and stop the native menu acting on them.
  function release() {
    lifecycle.reset()
    localIndexesList.value = []
    localSelectedIndex.value = null
    idx.selectedIndex.value = null
    idx.indexesTarget.value = null
  }

  // A confirmed drop runs from the app-level modal against a frozen target. Reload the
  // active workspace; request generations prevent an older response from overwriting a
  // workspace selected while this refresh is in flight.
  watch(() => idx.indexesRevision.value, () => {
    loadIndexes(activeTab())
  })
  watch(refreshRequest, () => loadIndexes())

  // Paste: create an index from a JSON spec on the clipboard
  async function pasteIndex() {
    let text
    try { text = await navigator.clipboard.readText() } catch (e) { text = '' }
    const pasted = indexSeedFromClipboard(text)
    if (!pasted.ok) { showToast(pasted.message); return }
    openCreateIndex(pasted.seed)
  }

  // --- row rendering ---
  function toggleExpand(name) { localExpanded.value[name] = !localExpanded.value[name] }

  function typeOf(index)   { return indexType(index) }
  function propsOf(index)  { const p = indexProperties(index); return p.length ? p.join(', ') : '—' }
  function sizeOf(index)   { return fmtBytes(localIndexSizes.value[index.name], 'n/a') }
  function usageOf(index)  { const u = localIndexUsage.value[index.name]; return u == null ? 'n/a' : u }

  return {
    localIndexesList, localIndexesLoading, localIndexesError, localSelectedIndex,
    localIndexTotalSize, localIndexUsageError, localIndexFormOpen, localIndexFormMode,
    localIndexFormSeed, localIndexCreating, localExpanded,
    hasSel, selProtected, selHidden,
    loadIndexes, selectRow, submitIndex, openCreateIndex, closeIndexForm, toggleHidden,
    handleStartEdit, handleViewDetails, handleDropIndex, handleCopyIndex, pasteIndex,
    toggleExpand, typeOf, propsOf, sizeOf, usageOf, release,
  }
}
