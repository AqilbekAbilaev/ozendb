<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import BaseIcon from '../base/BaseIcon.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseSelect from '../base/BaseSelect.vue'
import BaseCheckbox from '../base/BaseCheckbox.vue'
import StateMessage from '../base/StateMessage.vue'
import ResultTable from '../results/ResultTable.vue'
import JsonResultView from '../results/JsonResultView.vue'
import TreeResultView from '../results/TreeResultView.vue'
import { useCurrentOps, FREQUENCIES, RETENTIONS, SLOW_THRESHOLDS } from '../../composables/useCurrentOps'
import { useConfirmDelete } from '../../composables/useConfirmDelete'

// The Current Operations tab: what the server is doing right now, refreshed on a timer.
// The list itself, the poll and the retention of finished ops live in useCurrentOps;
// this renders them.
const props = defineProps({
  activeTab: { type: Object, required: true },  // { connId, connName }
})

const {
  rows, visible, error, errorCode, loading, updatedAt,
  frequency, retention, ownOnly, showSys, slowOnly, slowSecs, dbName, collName, view,
  selectedOpid, retainedCount, load, kill,
} = useCurrentOps(() => props.activeTab)

// The grid owns the drill-down path, kept on the tab like every other collection grid.
const drillPath = computed({
  get: () => props.activeTab.drillPath || [],
  set: (value) => { props.activeTab.drillPath = value },
})

// The same three result views a collection tab offers, over the same shared components.
// All three show the currentOp documents exactly as the server sent them — every field,
// nothing curated away; the grid's own column reorder and drill-down do the rest.
const VIEWS = [
  { value: 'table', label: 'Table View' },
  { value: 'json',  label: 'JSON View' },
  { value: 'tree',  label: 'Tree View' },
]
const rawDocs = computed(() => visible.value.map(row => row.raw))

// Loading / error / empty are a property of the data, not of the chosen view, so the
// message replaces whichever view is selected.
const stateMode = computed(() => {
  if (loading.value) return 'loading'
  if (error.value && !rows.value.length) return 'error'
  if (!visible.value.length) return 'empty'
  return null
})
const emptyLabel = computed(() =>
  rows.value.length ? 'No operations match these filters' : 'No operations currently in progress'
)

// Namespace pickers. The database list is loaded once; an empty value is the "all" sentinel.
const ALL = ''
const databases = ref([])
const dbOptions = computed(() => [
  { value: ALL, label: 'All databases' },
  ...databases.value.map(d => ({ value: d.name, label: d.name })),
])
const collOptions = computed(() => {
  const db = databases.value.find(d => d.name === dbName.value)
  return [
    { value: ALL, label: 'All collections' },
    ...((db && db.collections) || []).map(c => ({ value: c, label: c })),
  ]
})
onMounted(async () => {
  try {
    databases.value = await invoke('list_databases', { id: props.activeTab.connId })
  } catch (_) {
    // The pickers stay on "all" — a missing database list must not stop the ops view.
  }
})
// Switching database invalidates the chosen collection.
watch(dbName, () => { collName.value = ALL })

const selected = computed(() => visible.value.find(r => r.opid === selectedOpid.value) || null)
const { pendingId: pendingKill, confirmDelete: confirmKill, reset: resetKill } = useConfirmDelete()

// Two-click confirm on the toolbar button, as the drop actions elsewhere do: the first
// click arms it, the second kills. Killing an operation cannot be taken back.
async function killSelected() {
  const op = selected.value
  if (!op || op.expiredAt) return
  // Armed against this opid, so a list that reshuffles between the two clicks re-arms
  // rather than killing whatever is now under the cursor.
  if (!confirmKill(op.opid)) return
  await kill(op.opid)
}

// Keyed on the connection rather than onMounted: Vue reuses this component instance when
// the user switches between two Current Operations tabs, so mount fires only once.
watch(() => props.activeTab.connId, () => {
  rows.value = []
  resetKill()
  load()
}, { immediate: true })

// An armed kill must not survive the selection moving to a different operation.
watch(selectedOpid, resetKill)

// A tab switch unmounts the pane; drop the list so the next mount starts clean rather
// than briefly showing what a different connection was doing.
onUnmounted(() => { rows.value = [] })

const updatedText = computed(() =>
  updatedAt.value ? new Date(updatedAt.value).toLocaleTimeString() : '—'
)
</script>

<template>
  <div class="cops">
    <!-- Breadcrumb -->
    <div class="crumbs">
      <BaseIcon name="connect" :size="15" class="c-ic" />
      <span class="crumb">{{ activeTab.connName }}</span>
      <BaseIcon name="caret" :size="11" class="sep" />
      <BaseIcon name="dbSmall" :size="15" class="c-ic" />
      <BaseSelect v-model="dbName" class="cr-select" size="sm" :options="dbOptions" />
      <BaseIcon name="caret" :size="11" class="sep" />
      <BaseIcon name="collSmall" :size="15" class="c-ic" />
      <BaseSelect v-model="collName" class="cr-select" size="sm" :options="collOptions" :disabled="!dbName" />
    </div>

    <!-- Filters -->
    <div class="cops-filters">
      <label class="tb-opt">Filters:</label>
      <label class="cops-opt"><BaseCheckbox v-model="slowOnly" /> Show only slow ops</label>
      <BaseSelect v-model="slowSecs" class="tb-select" size="sm" :options="SLOW_THRESHOLDS" :disabled="!slowOnly" />
      <label class="cops-opt" title="Operations run by the user this connection authenticates as"><BaseCheckbox v-model="ownOnly" /> Show own ops only</label>
      <label class="cops-opt" title="Internal server threads and idle connections"><BaseCheckbox v-model="showSys" /> Show sys ops</label>
    </div>

    <!-- Toolbar -->
    <div class="cops-toolbar">
      <BaseButton variant="ghost" size="sm" icon="refresh" :icon-size="16" @click="load()">Refresh</BaseButton>
      <span class="tb-sep"></span>
      <BaseButton
        variant="ghost"
        size="sm"
        icon="trash"
        :icon-size="16"
        :class="{ armed: pendingKill != null }"
        :disabled="!selected || !!(selected && selected.expiredAt)"
        @click="killSelected"
      >{{ pendingKill != null ? 'Confirm kill' : 'Kill Operation' }}</BaseButton>
      <span class="tb-sep"></span>
      <label class="tb-opt">Update frequency:</label>
      <BaseSelect v-model="frequency" class="tb-select" size="sm" :options="FREQUENCIES" />
      <label class="tb-opt">Retain finished ops for:</label>
      <BaseSelect v-model="retention" class="tb-select" size="sm" :options="RETENTIONS" />
      <span class="spacer"></span>
      <BaseSelect v-model="view" class="tb-view" size="sm" :options="VIEWS" />
    </div>

    <!-- Nothing to show yet: one message for every view -->
    <div v-if="stateMode" class="cops-body">
      <StateMessage v-if="stateMode === 'loading'" mode="loading" label="Fetching current operations…" />
      <StateMessage v-else-if="stateMode === 'error'" mode="error" :message="error" :code="errorCode" />
      <StateMessage v-else mode="empty" :label="emptyLabel" />
    </div>

    <!-- JSON / Tree are the shared result viewers over the whole op documents. They size
         themselves as flex children of the pane, so they sit outside the scrolling body. -->
    <JsonResultView v-else-if="view === 'json'" :results="rawDocs" />
    <TreeResultView v-else-if="view === 'tree'" :results="rawDocs" />

    <!-- Operations: the shared result grid over the currentOp documents, read-only. -->
    <ResultTable
      v-else
      :active-tab="activeTab"
      :readonly="true"
      v-model:drillPath="drillPath"
    />

    <!-- Status bar -->
    <div class="cops-status">
      <span>Showing {{ visible.length }} of {{ rows.length }} operation{{ rows.length === 1 ? '' : 's' }}</span>
      <span class="spacer"></span>
      <span v-if="error" class="cops-err">{{ error }}</span>
      <span v-else-if="retainedCount" class="cops-retained">{{ retainedCount }} finished, still shown</span>
      <span v-else>updated {{ updatedText }}</span>
    </div>
  </div>
</template>

<style scoped>
/* min-height + overflow match .result-content, the container the shared grid is built to
   sit in: without them the grid's wide content stretches the pane instead of scrolling
   inside it, and the horizontal scrollbar never appears. */
.cops {
  flex: 1; display: flex; flex-direction: column;
  min-width: 0; min-height: 0; overflow: hidden;
  background: var(--bg-window);
}

.crumbs {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 14px; font-size: 12.5px; color: var(--text-dim);
  border-bottom: 1px solid var(--border); flex: none;
}
.sep { color: var(--text-faint); }
.c-ic { color: var(--text-faint); }

.cops-filters {
  display: flex; align-items: center; gap: 12px;
  padding: 6px 14px; flex: none;
  border-bottom: 1px solid var(--border);
}
.cops-opt { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-dim); cursor: pointer; }
.cr-select { flex: none; width: 170px; }

.cops-toolbar {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px; background: var(--bg-toolbar);
  border-bottom: 1px solid var(--border); flex: none;
}
.tb-sep { width: 1px; align-self: stretch; margin: 3px 6px; background: var(--border); }
.tb-opt { font-size: 12px; color: var(--text-dim); }
.tb-select { flex: none; width: 92px; }

.cops-body { flex: 1; overflow: auto; min-height: 0; }

.cops-status {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 12px; font-size: 12px; color: var(--text-dim);
  background: var(--bg-toolbar); border-top: 1px solid var(--border); flex: none;
}
.cops-status .spacer { flex: 1; }
.cops-toolbar .spacer { flex: 1; }
.tb-view { flex: none; width: 122px; }
.cops-err { color: var(--danger-text); }
.cops-retained { color: var(--text-faint); }
</style>
