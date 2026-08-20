import { ref } from 'vue'
import { dropIndex as dropIndexApi, indexStats } from '../engines/mongodb/api/indexes'
import { errText } from '../utils/errors'
import { isProtectedIndex, indexSpecJson } from '../utils/indexSpec'
// NOTE: indexSpecJson is needed because copyIndex() calls it. App.vue ALSO keeps
// its own indexSpecJson import for the template — both importing the pure helper is fine.

// Index-menu + modal actions shared across the app. The Index Manager tab keeps its
// own per-tab list, form, and metrics (IndexManagerPane); this composable only owns
// the app-level surfaces that overlay or act on it: View Details, the type-to-confirm
// Drop, and the Index menu actions. `showToast` is injected so the composable stays
// UI-agnostic.
export function useIndexes({ showToast }) {
  const indexesTarget = ref(null)  // { connId, dbName, collName } | null

  // API target derived from the current indexes target.
  function apiTarget() {
    const t = indexesTarget.value
    return { connectionId: t.connId, database: t.dbName, collection: t.collName }
  }

  // Index-menu selection. `selectedIndex` is the index row highlighted in the Index
  // Manager; it drives the Index menu's enablement (see menuContext) and is the target
  // of every Index-menu action.
  const selectedIndex = ref(null)  // the selected index doc | null
  const indexDetailsTarget = ref(null)   // the index shown in the View Details modal | null
  const indexDetailsStats  = ref(null)   // its $indexStats entry | null
  const indexDetailsLoading = ref(false)
  const dropIndexTarget = ref(null)   // { name, connId, dbName, collName } armed for the type-to-confirm drop | null
  const dropIndexConfirmText = ref('')
  const dropIndexError = ref(null)
  const dropIndexBusy = ref(false)

  // Bumped after a successful drop so the Index Manager pane owning the affected
  // collection can reload its per-tab list — the confirm modal can outlive the pane
  // instance that opened it (see the pane's watch on this ref).
  const indexesRevision = ref(0)

  // The selected index, or null with a nudge if somehow invoked without one. The
  // Index-menu gate guarantees a selection, so this is just defensive.
  function requireSelectedIndex() {
    if (!indexesTarget.value || !selectedIndex.value) {
      showToast('Select an index first')
      return null
    }
    return selectedIndex.value
  }

  // View Details: show the full spec (read-only) plus usage stats when available.
  async function openIndexDetails() {
    const idx = requireSelectedIndex()
    if (!idx) return
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

  // Drop Index: open the type-to-confirm dialog; never for the _id_ index. The target
  // is frozen at open time (name + collection) so confirming later can never hit a
  // different collection — the user may switch Index Manager tabs while the modal is up.
  function openDropIndexConfirm() {
    const idx = requireSelectedIndex()
    if (!idx) return
    if (isProtectedIndex(idx.name)) {
      showToast('The _id index cannot be dropped')
      return
    }
    const target = indexesTarget.value
    dropIndexTarget.value = { name: idx.name, ...target }
    dropIndexConfirmText.value = ''
    dropIndexError.value = null
  }

  async function confirmDropIndex() {
    const drop = dropIndexTarget.value
    if (!drop || !drop.connId) return
    if (dropIndexConfirmText.value !== drop.name) return
    dropIndexBusy.value = true
    dropIndexError.value = null
    try {
      await dropIndexApi(
        { connectionId: drop.connId, database: drop.dbName, collection: drop.collName },
        drop.name,
      )
      dropIndexTarget.value = null
      indexesRevision.value++
      showToast(`Index "${drop.name}" dropped`)
    } catch (e) {
      dropIndexError.value = errText(e)
    } finally {
      dropIndexBusy.value = false
    }
  }

  return {
    indexesTarget,
    selectedIndex,
    indexDetailsTarget,
    indexDetailsStats,
    indexDetailsLoading,
    dropIndexTarget,
    dropIndexConfirmText,
    dropIndexError,
    dropIndexBusy,
    indexesRevision,
    openIndexDetails,
    formatIndexSince,
    copyIndex,
    openDropIndexConfirm,
    confirmDropIndex,
  }
}