<script setup>
import { computed, ref, inject, watch, onUnmounted } from 'vue'
import BaseIcon from '../base/BaseIcon.vue'
import BaseButton from '../base/BaseButton.vue'
import IndexAddDialog from '../query/IndexAddDialog.vue'
import { createIndex, dropIndex, indexStats, listIndexes, setIndexHidden } from '../../engines/mongodb/api/indexes'
import { collectionStats } from '../../engines/mongodb/api/admin'
import {
  isProtectedIndex, isIndexHidden, indexKeyLabel, indexType, indexProperties,
} from '../../utils/indexSpec'
import { errText, errMessage } from '../../utils/errors'
import { fmtBytes } from '../../utils/format'
import { useIndexPaneLifecycle } from '../../composables/useIndexPaneLifecycle'
import CollectionCrumbs from '../base/CollectionCrumbs.vue'

// Each Index Manager tab manages its own index list, selection, and metrics
// independently so that two tabs for different collections don't interfere.
// The shared useIndexes composable (via appModals) is only used for modal
// state (View Details, Drop Index) and native Index menu actions.
const props = defineProps({
  activeTab: { type: Object, required: true },
})

const bundle = inject('appModals')
const idx = bundle.indexes
const showToast = bundle.handlers.showToast

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

async function loadIndexes(tab = props.activeTab) {
  const request = lifecycle.beginLoad(tab)
  localIndexesLoading.value = true
  localIndexesError.value = null
  try {
    const indexes = await listIndexes(request.target)
    if (!lifecycle.isCurrentLoad(request, props.activeTab)) return
    localIndexesList.value = indexes
  } catch (e) {
    if (!lifecycle.isCurrentLoad(request, props.activeTab)) return
    localIndexesError.value = errText(e)
    localIndexesList.value = []
  } finally {
    if (lifecycle.isCurrentLoad(request, props.activeTab)) localIndexesLoading.value = false
  }
  await loadIndexMetrics(request)
}

async function loadIndexMetrics(request) {
  try {
    const stats = await collectionStats(request.target)
    if (!lifecycle.isCurrentLoad(request, props.activeTab)) return
    const sizes = {}
    for (const entry of (stats.indexes || [])) sizes[entry.name] = entry.size
    localIndexSizes.value = sizes
    localIndexTotalSize.value = stats.total_index_size ?? null
  } catch (e) {
    if (!lifecycle.isCurrentLoad(request, props.activeTab)) return
    localIndexSizes.value = {}
    localIndexTotalSize.value = null
  }
  try {
    const stats = await indexStats(request.target)
    if (!lifecycle.isCurrentLoad(request, props.activeTab)) return
    const usage = {}
    for (const entry of stats) {
      const ops = entry && entry.accesses && entry.accesses.ops
      if (ops != null) usage[entry.name] = typeof ops === 'object' ? (ops.$numberLong ?? null) : ops
    }
    localIndexUsage.value = usage
    localIndexUsageError.value = null
  } catch (e) {
    if (!lifecycle.isCurrentLoad(request, props.activeTab)) return
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
    if (lifecycle.isCurrentFormSubmit(submission, props.activeTab)) {
      closeIndexForm()
    }
    if (lifecycle.isTargetActive(target, props.activeTab)) await loadIndexes(props.activeTab)
    showToast(editing ? 'Index updated' : 'Index created')
  } catch (e) {
    const message = errText(e)
    if (lifecycle.isCurrentFormSubmit(submission, props.activeTab)) {
      localIndexesError.value = message
    } else {
      showToast(`${editing ? 'Index update' : 'Index creation'} failed: ${message}`)
    }
  } finally {
    if (lifecycle.isCurrentFormSubmit(submission, props.activeTab)) {
      localIndexCreating.value = false
    }
  }
}

function openCreateIndex(seed) {
  lifecycle.captureFormTarget(props.activeTab)
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

async function toggleHidden() {
  const it = localSelectedIndex.value
  if (!it) return
  const target = lifecycle.targetForTab(props.activeTab)
  const hidden = !isIndexHidden(it)
  localIndexesError.value = null
  try {
    await setIndexHidden(target, it.name, hidden)
    if (lifecycle.isTargetActive(target, props.activeTab)) await loadIndexes(props.activeTab)
    showToast(hidden ? `Index "${it.name}" hidden` : `Index "${it.name}" unhidden`)
  } catch (e) {
    const message = errText(e)
    if (lifecycle.isTargetActive(target, props.activeTab)) {
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
  lifecycle.captureFormTarget(props.activeTab)
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

// Expose a menu API so App.vue's native Index menu can reach this tab
const menuApi = {
  selectedIndex: localSelectedIndex,
  startEditIndex: handleStartEdit,
  openIndexDetails: handleViewDetails,
  copyIndex: handleCopyIndex,
  openDropIndexConfirm: handleDropIndex,
  setIndexHidden: toggleHidden,
}

// Vue reuses this pane while switching directly between Index Manager tabs. Move the
// native-menu API with the active workspace, reset local UI state, and invalidate any
// async response started by the previous workspace before loading the new target.
watch(() => props.activeTab, (tab) => {
  lifecycle.attachMenuApi(tab, menuApi)
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
    connId: tab.connId,
    dbName: tab.dbName,
    collName: tab.collName,
  }
  loadIndexes(tab)
}, { immediate: true })

onUnmounted(() => {
  lifecycle.detachMenuApi(menuApi)
  localIndexesList.value = []
  localSelectedIndex.value = null
  idx.selectedIndex.value = null
  idx.indexesTarget.value = null
})

// A confirmed drop runs from the app-level modal against a frozen target. Reload the
// active workspace; request generations prevent an older response from overwriting a
// workspace selected while this refresh is in flight.
watch(() => idx.indexesRevision.value, () => {
  loadIndexes(props.activeTab)
})

// Paste: create an index from a JSON spec on the clipboard
async function pasteIndex() {
  let text = ''
  try { text = await navigator.clipboard.readText() } catch (e) { text = '' }
  if (!text.trim()) { showToast('Clipboard is empty'); return }
  let spec
  try { spec = JSON.parse(text) } catch (e) { showToast('Clipboard is not a valid index spec'); return }
  if (!spec || typeof spec.key !== 'object') { showToast('Clipboard is not an index spec'); return }
  const seed = Object.assign({}, spec)
  delete seed.name
  openCreateIndex(seed)
}

// --- row rendering ---
function toggleExpand(name) { localExpanded.value[name] = !localExpanded.value[name] }

function typeOf(index)   { return indexType(index) }
function propsOf(index)  { const p = indexProperties(index); return p.length ? p.join(', ') : '—' }
function sizeOf(index)   { return fmtBytes(localIndexSizes.value[index.name], 'n/a') }
function usageOf(index)  { const u = localIndexUsage.value[index.name]; return u == null ? 'n/a' : u }

</script>

<template>
  <div class="idxm">
    <!-- Breadcrumb -->
    <CollectionCrumbs :conn="activeTab.connName" :db="activeTab.dbName" :coll="activeTab.collName" icon="anchor" label="Indexes" />

    <!-- Toolbar -->
    <div class="idx-toolbar">
      <BaseButton variant="ghost" size="sm" icon="refresh" :icon-size="16" @click="loadIndexes()">Refresh</BaseButton>
      <BaseButton variant="ghost" size="sm" icon="plus" :icon-size="16" @click="openCreateIndex()">Add index</BaseButton>
      <span class="tb-sep"></span>
      <BaseButton variant="ghost" size="sm" icon="trash" :icon-size="16" :disabled="!hasSel || selProtected" @click="handleDropIndex()">Drop index</BaseButton>
      <BaseButton variant="ghost" size="sm" icon="edit" :icon-size="16" :disabled="!hasSel || selProtected" @click="handleStartEdit()">Edit index</BaseButton>
      <BaseButton variant="ghost" size="sm" icon="eye" :icon-size="16" :disabled="!hasSel" @click="handleViewDetails()">View details</BaseButton>
      <BaseButton variant="ghost" size="sm" :icon="selHidden ? 'eye' : 'eyeOff'" :icon-size="16" :disabled="!hasSel || selProtected" @click="toggleHidden()">{{ selHidden ? 'Unhide index' : 'Hide index' }}</BaseButton>
      <span class="tb-sep"></span>
      <BaseButton variant="ghost" size="sm" icon="copy" :icon-size="16" :disabled="!hasSel" @click="handleCopyIndex()">Copy</BaseButton>
      <BaseButton variant="ghost" size="sm" icon="paste" :icon-size="16" @click="pasteIndex()">Paste</BaseButton>
    </div>

    <!-- Index list -->
    <div class="idx-body">
      <div v-if="localIndexesLoading" class="idx-msg">Loading indexes…</div>
      <div v-else-if="localIndexesError" class="idx-msg idx-err">{{ localIndexesError }}</div>
      <table v-else class="idx-table">
        <thead>
          <tr>
            <th class="col-name">Name</th>
            <th class="col-type">Type</th>
            <th class="col-props">Properties</th>
            <th class="col-size">Size</th>
            <th class="col-usage">
              Usage
              <span
                v-if="localIndexUsageError"
                class="usage-warn"
                :title="`Index usage unavailable: ${localIndexUsageError}`"
              ><BaseIcon name="info" :size="12" /></span>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="index in localIndexesList" :key="index.name">
            <tr
              class="idx-row"
              :class="{ selected: localSelectedIndex && localSelectedIndex.name === index.name }"
              @click="selectRow(index)"
            >
              <td class="col-name">
                <span class="name-inner">
                  <BaseButton icon="caret" :icon-size="11" class="caret" :class="{ open: localExpanded[index.name] }" @click.stop="toggleExpand(index.name)" />
                  {{ index.name }}
                </span>
              </td>
              <td class="col-type">{{ typeOf(index) }}</td>
              <td class="col-props">{{ propsOf(index) }}</td>
              <td class="col-size">{{ sizeOf(index) }}</td>
              <td class="col-usage">{{ usageOf(index) }}</td>
            </tr>
            <tr v-if="localExpanded[index.name]" class="idx-detail">
              <td colspan="5"><span class="dt-label">Fields:</span> {{ indexKeyLabel(index) || '—' }}</td>
            </tr>
          </template>
          <tr v-if="!localIndexesList.length"><td colspan="5" class="idx-empty">No indexes.</td></tr>
        </tbody>
      </table>
    </div>

    <!-- Status bar -->
    <div class="idx-status">
      <span>{{ localIndexesList.length }} {{ localIndexesList.length === 1 ? 'Index' : 'Indexes' }}</span>
      <span class="spacer"></span>
      <span v-if="localIndexTotalSize != null">{{ fmtBytes(localIndexTotalSize, 'n/a') }}</span>
    </div>

    <!-- Add / Edit index dialog -->
    <IndexAddDialog
      v-if="localIndexFormOpen"
      :mode="localIndexFormMode"
      :seed="localIndexFormSeed"
      :busy="localIndexCreating"
      :error="localIndexesError"
      @submit="submitIndex"
      @cancel="closeIndexForm"
    />
  </div>
</template>

<style scoped>
.idxm { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg-window); }

/* Breadcrumb (mirrors the collection tab) */

/* Toolbar */
.idx-toolbar {
  display: flex; align-items: center; gap: 2px;
  padding: 5px 8px; background: var(--bg-toolbar);
  border-bottom: 1px solid var(--border); flex: none;
}
.tb-sep { width: 1px; align-self: stretch; margin: 3px 6px; background: var(--border); }

/* Table */
.idx-body { flex: 1; overflow: auto; min-height: 0; }
.idx-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.idx-table thead th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; font-weight: 600; color: var(--text-dim);
  background: var(--bg-panel); padding: 6px 10px;
  border-bottom: 1px solid var(--border); border-right: 1px solid var(--border-soft);
}
.idx-row td {
  padding: 5px 10px; color: var(--text); vertical-align: middle;
  border-bottom: 1px solid var(--grid-line); border-right: 1px solid var(--border-soft);
  white-space: nowrap;
}
.idx-row { cursor: pointer; }
.idx-row:hover { background: var(--bg-hover); }
.idx-row.selected { background: var(--accent); color: #fff; }
.idx-row.selected td { color: #fff; }
.col-name { white-space: nowrap; }
/* Marker on the Usage header when $indexStats failed (e.g. missing indexStats privilege).
   The tooltip carries the reason so "n/a" isn't a dead end. */
.usage-warn {
  display: inline-flex; align-items: center; vertical-align: middle;
  margin-left: 4px; color: var(--danger-text); cursor: help;
}
.name-inner { display: inline-flex; align-items: center; gap: 4px; vertical-align: middle; }
.base-btn.caret {
  border: none; background: transparent; padding: 0; cursor: pointer;
  color: var(--text-faint); display: inline-flex; transition: transform .12s;
}
.base-btn.caret.open { transform: rotate(90deg); }
.idx-row.selected .base-btn.caret { color: #fff; }
.idx-detail td {
  padding: 4px 10px 6px 30px; font-size: 12px; color: var(--text-dim);
  background: var(--bg-row-alt); border-bottom: 1px solid var(--grid-line);
}
.dt-label { color: var(--text-faint); margin-right: 4px; }
.idx-empty { padding: 14px 10px; color: var(--text-dim); }
.idx-msg { padding: 14px; color: var(--text-dim); font-size: 12.5px; }
.idx-err { color: var(--danger-text); }

/* Status bar */
.idx-status {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 12px; font-size: 12px; color: var(--text-dim);
  background: var(--bg-toolbar); border-top: 1px solid var(--border); flex: none;
}
.idx-status .spacer { flex: 1; }

</style>
