import { ref } from 'vue'
import { collectionStats } from '../engines/mongodb/api/admin'
import { createIndex, dropIndex as dropIndexApi, indexStats, listIndexes, setIndexHidden as setIndexHiddenApi } from '../engines/mongodb/api/indexes'
import { errText, errMessage } from '../utils/errors'
import { isProtectedIndex, indexSpecJson } from '../utils/indexSpec'
// NOTE: indexSpecJson is needed because copyIndex() calls it. App.vue ALSO keeps
// its own indexSpecJson import for the template — both importing the pure helper is fine.

// Index-management state + actions for the Indexes dialog and Index menu.
// `showToast` is injected so the composable stays UI-agnostic.
export function useIndexes({ showToast }) {
  const indexesTarget   = ref(null)  // { connId, dbName, collName } | null

  // API target derived from the current indexes dialog target.
  function apiTarget() {
    const t = indexesTarget.value
    return { connectionId: t.connId, database: t.dbName, collection: t.collName }
  }
  const indexesList     = ref([])
  const indexesLoading  = ref(false)
  const indexesError    = ref(null)
  const indexCreating   = ref(false)
  const indexFormOpen   = ref(false)  // the Add/Edit index dialog is showing
  const indexFormSeed   = ref(null)   // index spec used to prefill the dialog (edit / paste)
  const pendingDropIndex = ref(null)  // index name armed for a confirming second click

  // Per-index size (bytes) and usage (operation count) shown in the Index Manager,
  // keyed by index name. Both are best-effort: size comes from collStats.indexSizes,
  // usage from $indexStats — either can be unavailable, leaving an index unlisted here.
  const indexSizes     = ref({})
  const indexUsage     = ref({})
  const indexUsageError = ref(null)  // why $indexStats failed (e.g. missing indexStats privilege), for a hint in the UI
  const indexTotalSize = ref(null)   // collStats.totalIndexSize, for the status bar

  // Index-menu selection & dialogs. `selectedIndex` is the index row highlighted in
  // the Indexes dialog; it drives the Index menu's enablement (see menuContext) and
  // is the target of every Index-menu action.
  const selectedIndex        = ref(null)   // the selected index doc | null
  const indexFormMode        = ref('create')  // 'create' | 'edit'
  const indexEditOriginalName = ref('')    // name of the index being edited (edit mode)
  const indexDetailsTarget   = ref(null)   // the index shown in the View Details modal | null
  const indexDetailsStats    = ref(null)   // its $indexStats entry | null
  const indexDetailsLoading  = ref(false)
  const dropIndexTarget      = ref(null)   // { name } armed for the type-to-confirm drop | null
  const dropIndexConfirmText = ref('')
  const dropIndexError       = ref(null)
  const dropIndexBusy        = ref(false)

  async function loadIndexes() {
    const target = indexesTarget.value
    if (!target) return
    indexesLoading.value = true
    indexesError.value = null
    try {
      indexesList.value = await listIndexes(apiTarget())
      // Re-point the selection at the reloaded index object (a fresh list replaces
      // the old references); clear it if that index no longer exists.
      if (selectedIndex.value) {
        selectedIndex.value = indexesList.value.find(i => i.name === selectedIndex.value.name) || null
      }
    } catch (e) {
      indexesError.value = errText(e)
      indexesList.value = []
    } finally {
      indexesLoading.value = false
    }
    await loadIndexMetrics(target)
  }

  // Size + usage for the loaded indexes. Kept separate from loadIndexes so a server
  // that doesn't support collStats/$indexStats still shows the index list — the Size
  // and Usage columns just read "n/a" for those entries.
  async function loadIndexMetrics(target) {
    try {
      const stats = await collectionStats(apiTarget())
      const sizes = {}
      for (const entry of (stats.indexes || [])) sizes[entry.name] = entry.size
      indexSizes.value = sizes
      indexTotalSize.value = stats.total_index_size ?? null
    } catch (e) {
      indexSizes.value = {}
      indexTotalSize.value = null
    }
    try {
      const stats = await indexStats(apiTarget())
      const usage = {}
      for (const entry of stats) {
        const ops = entry && entry.accesses && entry.accesses.ops
        if (ops != null) usage[entry.name] = typeof ops === 'object' ? (ops.$numberLong ?? null) : ops
      }
      indexUsage.value = usage
      indexUsageError.value = null
    } catch (e) {
      // $indexStats is best-effort (needs the indexStats privilege; also unsupported on
      // some deployments). Keep the pane working, but keep the reason so the Usage column
      // can explain why it reads "n/a" instead of leaving the user guessing. Use the raw
      // message (not errText) — the tooltip is a details surface, and errText would
      // collapse a mongo error to the generic "The database reported an error" title.
      indexUsage.value = {}
      indexUsageError.value = errMessage(e)
    }
  }

  // Reset the create/edit form back to a blank create.
  function resetIndexForm() {
    indexFormMode.value = 'create'
    indexEditOriginalName.value = ''
    indexFormSeed.value = null
  }

  // Open the Add-index dialog on a blank create form. An optional `seed` (a partial
  // index spec, e.g. from Paste) prefills the dialog's fields.
  function openCreateIndex(seed = null) {
    resetIndexForm()
    indexFormSeed.value = seed
    indexFormOpen.value = true
  }

  // Close the Add/Edit dialog and discard any half-typed form values.
  function closeIndexForm() {
    indexFormOpen.value = false
    indexesError.value = null
    resetIndexForm()
  }

  // Closes the Indexes dialog and clears its selection/form so the Index menu
  // disables again (and any half-typed edit is discarded).
  function closeIndexesModal() {
    indexesTarget.value = null
    selectedIndex.value = null
    pendingDropIndex.value = null
    indexFormOpen.value = false
    indexesError.value = null
    resetIndexForm()
  }

  // Create (or, in edit mode, drop-and-recreate) an index from the dialog's assembled
  // `keys` and `options` JSON strings. MongoDB has no in-place index edit, so an edit
  // drops the original first, then recreates it from the (possibly changed) values.
  async function submitIndex({ keys, options }) {
    const target = indexesTarget.value
    if (!target || !keys || !keys.trim()) return
    const editing = indexFormMode.value === 'edit' && !!indexEditOriginalName.value
    indexCreating.value = true
    indexesError.value = null
    try {
      if (editing) {
        await dropIndexApi(apiTarget(), indexEditOriginalName.value)
      }
      await createIndex(apiTarget(), keys, options || '{}')
      closeIndexForm()
      await loadIndexes()
      showToast(editing ? 'Index updated' : 'Index created')
    } catch (e) {
      indexesError.value = errText(e)
    } finally {
      indexCreating.value = false
    }
  }

  // Two-click guard: the first click arms a row, the second actually drops it.
  async function dropIndex(name) {
    if (pendingDropIndex.value !== name) {
      pendingDropIndex.value = name
      return
    }
    const target = indexesTarget.value
    if (!target) return
    indexesError.value = null
    try {
      await dropIndexApi(apiTarget(), name)
      pendingDropIndex.value = null
      await loadIndexes()
      showToast(`Index "${name}" dropped`)
    } catch (e) {
      indexesError.value = errText(e)
      pendingDropIndex.value = null
    }
  }

  // --- Index menu actions (operate on the selected row in the Indexes dialog) ---

  // The selected index, or null with a nudge if somehow invoked without one. The
  // Index-menu gate guarantees a selection, so this is just defensive.
  function requireSelectedIndex() {
    if (!indexesTarget.value || !selectedIndex.value) {
      showToast('Select an index first')
      return null
    }
    return selectedIndex.value
  }

  // Edit Index…: open the dialog seeded with the selected index and switch it to
  // edit mode (save = drop-and-recreate).
  function startEditIndex() {
    const idx = requireSelectedIndex()
    if (!idx) return
    if (isProtectedIndex(idx.name)) {
      showToast('The _id index cannot be edited')
      return
    }
    indexFormMode.value = 'edit'
    indexEditOriginalName.value = idx.name
    indexFormSeed.value = idx
    indexFormOpen.value = true
  }

  // View Details: show the full spec (read-only) plus usage stats when available.
  async function openIndexDetails() {
    const idx = requireSelectedIndex()
    if (!idx) return
    const target = indexesTarget.value
    indexDetailsTarget.value = idx
    indexDetailsStats.value = null
    indexDetailsLoading.value = true
    try {
      const all = await indexStats(apiTarget())
      indexDetailsStats.value = all.find(s => s.name === idx.name) || null
    } catch (e) {
      // $indexStats can be unsupported (older server, non-replicated deployment);
      // the spec is still shown, just without usage numbers.
      indexDetailsStats.value = null
    } finally {
      indexDetailsLoading.value = false
    }
  }

  // $indexStats.accesses.since is a BSON date, which crosses the wire as relaxed
  // Extended JSON (a string, or a { $date } wrapper). Render whichever we get as a
  // plain string rather than "[object Object]".
  function formatIndexSince(value) {
    if (value == null) return '—'
    if (typeof value === 'object') {
      const inner = value.$date
      if (inner == null) return JSON.stringify(value)
      return typeof inner === 'object' ? (inner.$numberLong ?? JSON.stringify(inner)) : inner
    }
    return value
  }

  // Copy Index: put the full index definition on the clipboard as pretty JSON.
  function copyIndex() {
    const idx = requireSelectedIndex()
    if (!idx) return
    navigator.clipboard.writeText(indexSpecJson(idx))
    showToast('Index copied')
  }

  // Drop Index: open the type-to-confirm dialog; never for the _id_ index.
  function openDropIndexConfirm() {
    const idx = requireSelectedIndex()
    if (!idx) return
    if (isProtectedIndex(idx.name)) {
      showToast('The _id index cannot be dropped')
      return
    }
    dropIndexTarget.value = { name: idx.name }
    dropIndexConfirmText.value = ''
    dropIndexError.value = null
  }

  async function confirmDropIndex() {
    const target = indexesTarget.value
    const drop = dropIndexTarget.value
    if (!target || !drop) return
    if (dropIndexConfirmText.value !== drop.name) return
    dropIndexBusy.value = true
    dropIndexError.value = null
    try {
      await dropIndexApi(apiTarget(), drop.name)
      dropIndexTarget.value = null
      await loadIndexes()
      showToast(`Index "${drop.name}" dropped`)
    } catch (e) {
      dropIndexError.value = errText(e)
    } finally {
      dropIndexBusy.value = false
    }
  }

  // Hide / Unhide Index: toggle the planner-visibility flag without a rebuild.
  async function setIndexHidden(hidden) {
    const idx = requireSelectedIndex()
    if (!idx) return
    if (isProtectedIndex(idx.name)) {
      showToast('The _id index cannot be hidden')
      return
    }
    const target = indexesTarget.value
    const name = idx.name
    indexesError.value = null
    try {
      await setIndexHiddenApi(apiTarget(), name, hidden)
      await loadIndexes()
      showToast(hidden ? `Index "${name}" hidden` : `Index "${name}" unhidden`)
    } catch (e) {
      indexesError.value = errText(e)
    }
  }

  // Opener: absorbs App.vue's old "Indexes…" branch body.
  async function openIndexes(target) {
    indexesTarget.value = {
      connId: target.connId,
      dbName: target.dbName,
      collName: target.collName,
    }
    indexesError.value = null
    selectedIndex.value = null
    pendingDropIndex.value = null
    resetIndexForm()
    await loadIndexes()
  }

  return {
    indexesTarget: indexesTarget,
    indexesList: indexesList,
    indexesLoading: indexesLoading,
    indexesError: indexesError,
    indexCreating: indexCreating,
    indexFormOpen: indexFormOpen,
    indexFormSeed: indexFormSeed,
    indexSizes: indexSizes,
    indexUsage: indexUsage,
    indexUsageError: indexUsageError,
    indexTotalSize: indexTotalSize,
    pendingDropIndex: pendingDropIndex,
    selectedIndex: selectedIndex,
    indexFormMode: indexFormMode,
    indexEditOriginalName: indexEditOriginalName,
    indexDetailsTarget: indexDetailsTarget,
    indexDetailsStats: indexDetailsStats,
    indexDetailsLoading: indexDetailsLoading,
    dropIndexTarget: dropIndexTarget,
    dropIndexConfirmText: dropIndexConfirmText,
    dropIndexError: dropIndexError,
    dropIndexBusy: dropIndexBusy,
    loadIndexes: loadIndexes,
    openCreateIndex: openCreateIndex,
    closeIndexForm: closeIndexForm,
    closeIndexesModal: closeIndexesModal,
    submitIndex: submitIndex,
    dropIndex: dropIndex,
    startEditIndex: startEditIndex,
    openIndexDetails: openIndexDetails,
    formatIndexSince: formatIndexSince,
    copyIndex: copyIndex,
    openDropIndexConfirm: openDropIndexConfirm,
    confirmDropIndex: confirmDropIndex,
    setIndexHidden: setIndexHidden,
    openIndexes: openIndexes,
  }
}
