<script setup>
import { computed } from 'vue'
import SegmentedControl from '../../../components/base/SegmentedControl.vue'
import WorkspaceCrumbs from '../../../components/base/WorkspaceCrumbs.vue'
import { openConnections } from '../../../stores/openConnections'
import { crumbSegments } from '../../../utils/crumbSegments'

// The table tab's top line: engine, login and server, the table's path, and the
// Filter / SQL switch.
const props = defineProps({
  activeTab: { type: Object, required: true },
  mode:      { type: String, required: true },
})
const emit = defineEmits(['mode'])

const MODES = [{ value: 'filter', label: 'Filter', icon: 'filter' }, { value: 'sql', label: 'SQL', icon: 'sql' }]

const conn = computed(() => openConnections.value.find(c => c.id === props.activeTab.connectionId))
const items = computed(() => {
  const host = conn.value?.hosts?.[0]
  const server = host ? ` (${host.host}:${host.port})` : ''
  return crumbSegments({ user: conn.value?.username, connection: props.activeTab.connectionName + server, target: props.activeTab.target })
})
</script>

<template>
  <WorkspaceCrumbs engine="postgresql" :items="items">
    <SegmentedControl :model-value="mode" :options="MODES" variant="subtle" @update:model-value="emit('mode', $event)" />
  </WorkspaceCrumbs>
</template>
