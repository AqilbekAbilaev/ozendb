<script setup>
// The workspace host: tab bar, non-collection pane dispatch, and the root layout.
// All MongoDB collection query behavior (find/aggregate/SQL run, explain, saved-query
// browser) lives in MongoCollectionWorkspace.vue; this component forwards the App
// contract to it unchanged.
import { ref, computed, defineAsyncComponent } from 'vue'
import TabBar from '../base/TabBar.vue'
import QuickstartPane from '../panes/QuickstartPane.vue'
// Lazy-loaded so CodeMirror (a large dep) is only fetched when a shell tab opens.
const ShellConsole = defineAsyncComponent(() => import('../app/ShellConsole.vue'))
import IndexManagerPane from '../panes/IndexManagerPane.vue'
import SchemaPane from '../panes/SchemaPane.vue'
import SearchPane from '../panes/SearchPane.vue'
import CurrentOpsPane from '../panes/CurrentOpsPane.vue'
import ImportPane from '../panes/ImportPane.vue'
import CsvImportPane from '../panes/CsvImportPane.vue'
import ExportPane from '../panes/ExportPane.vue'
import MongoCollectionWorkspace from '../../engines/mongodb/workspaces/collection/MongoCollectionWorkspace.vue'

const props = defineProps({
  tabs:           { type: Array,   required: true },
  activeTabId:    { type: String,  required: true },
  tagOverrides:   { type: Object,  default: () => ({}) },
  vqbOpen:        { type: Boolean, default: false },
  clipboardQuery: { type: Object,  default: null },
  docMenuRequest: { type: Object,  default: null },
  historyRequest: { type: Object,  default: null },
  browserRequest: { type: Object,  default: null },
  saveQueryRequest: { type: Object, default: null },
})
const emit = defineEmits(['activate-tab', 'close-tab', 'reorder-tab', 'tab-context', 'run-query', 'run-aggregate', 'toggle-vqb', 'open-vqb', 'close-vqb', 'copy-query', 'paste-query', 'cancel-query', 'follow-reference'])

const activeTab = computed(() => props.tabs.find(t => t.id === props.activeTabId))

// Which result sub-tab is active. Kept here (rather than in MongoCollectionWorkspace)
// because the collection workspace unmounts when another pane kind activates: the
// sub-tab must survive collection → non-collection → collection switches.
const rtab = ref('Result')
</script>

<template>
  <div class="work">
    <!-- Tabs -->
    <TabBar
      :tabs="tabs"
      :active-tab-id="activeTabId"
      :tag-overrides="tagOverrides"
      @activate-tab="emit('activate-tab', $event)"
      @close-tab="emit('close-tab', $event)"
      @reorder-tab="(id, beforeId) => emit('reorder-tab', id, beforeId)"
      @tab-context="emit('tab-context', $event)"
    />

    <!-- Quickstart pane -->
    <QuickstartPane v-if="!activeTab || activeTab.kind === 'quickstart'" />

    <!-- IntelliShell -->
    <ShellConsole v-else-if="activeTab.kind === 'shell'" :active-tab="activeTab" />

    <!-- Index Manager -->
    <IndexManagerPane v-else-if="activeTab.kind === 'indexes'" :active-tab="activeTab" />

    <!-- Schema Explorer -->
    <SchemaPane v-else-if="activeTab.kind === 'schema'" :active-tab="activeTab" />

    <!-- Search -->
    <SearchPane v-else-if="activeTab.kind === 'search'" :active-tab="activeTab" />

    <!-- Current Operations -->
    <CurrentOpsPane v-else-if="activeTab.kind === 'currentOps'" :active-tab="activeTab" />

    <!-- Import (CSV uses the single-source, sub-tab layout; JSON the multi-source table) -->
    <!-- Export -->
    <ExportPane v-else-if="activeTab.kind === 'export'" :active-tab="activeTab" />

    <CsvImportPane v-else-if="activeTab.kind === 'import' && activeTab.format === 'csv'" :active-tab="activeTab" />
    <ImportPane v-else-if="activeTab.kind === 'import'" :active-tab="activeTab" />

    <!-- Collection workspace (engine-owned) -->
    <MongoCollectionWorkspace
      v-else-if="activeTab.kind === 'collection'"
      :active-tab="activeTab"
      :tabs="tabs"
      :active-tab-id="activeTabId"
      :result-tab="rtab"
      :vqb-open="vqbOpen"
      :clipboard-query="clipboardQuery"
      :doc-menu-request="docMenuRequest"
      :history-request="historyRequest"
      :browser-request="browserRequest"
      :save-query-request="saveQueryRequest"
      @update:result-tab="rtab = $event"
      @run-query="(id, q) => emit('run-query', id, q)"
      @run-aggregate="(id, agg) => emit('run-aggregate', id, agg)"
      @toggle-vqb="emit('toggle-vqb')"
      @open-vqb="emit('open-vqb')"
      @close-vqb="emit('close-vqb')"
      @copy-query="emit('copy-query')"
      @paste-query="emit('paste-query')"
      @cancel-query="emit('cancel-query', $event)"
      @follow-reference="emit('follow-reference', $event)"
    />
  </div>
</template>

<style scoped>
.work { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg-window); }
</style>