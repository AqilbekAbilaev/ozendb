<script setup>
// Generic workspace host (Work 4): active-tab lookup, tab bar, and dynamic rendering
// of the component resolved from the registry. Replaces the hard-coded pane-selection
// chain in QueryWorkspace.vue while preserving the App-facing contract unchanged.
// Props/listeners are built per resolved key so collection-only attributes never leak
// onto ordinary panes' root DOM nodes.
import { ref, computed } from 'vue'
import TabBar from '../base/TabBar.vue'
import { WORKSPACE_COMPONENTS, workspaceComponentFor } from '../../workspaces/registry'

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
const component = computed(() => workspaceComponentFor(activeTab.value))

// Which result sub-tab is active. Kept here (rather than in MongoCollectionWorkspace)
// because the collection workspace unmounts when another pane kind activates: the
// sub-tab must survive collection → non-collection → collection switches.
const rtab = ref('Result')

// Prop bindings per resolved kind: ordinary panes get the active tab, Quickstart
// gets none, and the collection workspace gets its full compatibility contract.
const bindings = computed(() => {
  if (component.value === WORKSPACE_COMPONENTS.quickstart) return {}
  if (component.value === WORKSPACE_COMPONENTS.collection) {
    return {
      activeTab:        activeTab.value,
      tabs:             props.tabs,
      activeTabId:      props.activeTabId,
      resultTab:        rtab.value,
      vqbOpen:          props.vqbOpen,
      clipboardQuery:   props.clipboardQuery,
      docMenuRequest:   props.docMenuRequest,
      historyRequest:   props.historyRequest,
      browserRequest:   props.browserRequest,
      saveQueryRequest: props.saveQueryRequest,
    }
  }
  return component.value ? { activeTab: activeTab.value } : {}
})

const collectionListeners = {
  'update:result-tab': (v) => { rtab.value = v },
  'run-query': (id, q) => emit('run-query', id, q),
  'run-aggregate': (id, a) => emit('run-aggregate', id, a),
  'toggle-vqb': () => emit('toggle-vqb'),
  'open-vqb': () => emit('open-vqb'),
  'close-vqb': () => emit('close-vqb'),
  'copy-query': () => emit('copy-query'),
  'paste-query': () => emit('paste-query'),
  'cancel-query': (id) => emit('cancel-query', id),
  'follow-reference': (e) => emit('follow-reference', e),
}
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

    <!-- Resolved workspace / pane -->
    <component
      :is="component"
      v-if="component"
      v-bind="bindings"
      v-on="component === WORKSPACE_COMPONENTS.collection ? collectionListeners : {}"
    />
  </div>
</template>

<style scoped>
.work { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg-window); }
</style>