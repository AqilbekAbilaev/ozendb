<script setup>
// Generic workspace host: active-tab lookup, tab bar, and dynamic rendering of the
// component resolved from the registry.
import { computed } from 'vue'
import TabBar from './TabBar.vue'
import { workspaceComponentFor, workspacePaneKind } from '../../workspaces/registry'

const props = defineProps({
  tabs:           { type: Array,   required: true },
  activeTabId:    { type: String,  required: true },
})
const emit = defineEmits(['activate-tab', 'close-tab', 'reorder-tab'])

const activeTab = computed(() => props.tabs.find(t => t.id === props.activeTabId))
const component = computed(() => workspaceComponentFor(activeTab.value))

// Every pane gets the active tab except Quickstart, which takes none. Read from the
// definition rather than compared against a known component, so this never needs to
// import an engine's own components.
const bindings = computed(() => {
  if (workspacePaneKind(activeTab.value) === 'quickstart') return {}
  return component.value ? { activeTab: activeTab.value } : {}
})
</script>

<template>
  <div class="work">
    <!-- Tabs -->
    <TabBar
      :tabs="tabs"
      :active-tab-id="activeTabId"
      @activate-tab="emit('activate-tab', $event)"
      @close-tab="emit('close-tab', $event)"
      @reorder-tab="(id, beforeId) => emit('reorder-tab', id, beforeId)"
    />

    <!-- Resolved workspace / pane -->
    <component
      :is="component"
      v-if="component"
      v-bind="bindings"
    />
  </div>
</template>

<style scoped>
.work { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg-window); }
</style>
