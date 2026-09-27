<script setup>
import { computed } from 'vue'
import WorkspaceCrumbs from '../../../components/base/WorkspaceCrumbs.vue'
import { openConnections } from '../../../stores/openConnections'
import { crumbSegments } from '../../../utils/crumbSegments'

// The table tab's crumbs: engine, login and server, and the table's path.
const props = defineProps({
  activeTab: { type: Object, required: true },
})

const conn = computed(() => openConnections.value.find(c => c.id === props.activeTab.connectionId))
const items = computed(() => {
  const host = conn.value?.hosts?.[0]
  const server = host ? ` (${host.host}:${host.port})` : ''
  return crumbSegments({ user: conn.value?.username, connection: props.activeTab.connectionName + server, target: props.activeTab.target })
})
</script>

<template>
  <WorkspaceCrumbs engine="postgresql" :items="items" />
</template>
