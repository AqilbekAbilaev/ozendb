<script setup>
import { computed } from 'vue'
import WorkspaceCrumbs from '../../../components/base/WorkspaceCrumbs.vue'
import PostgresSqlPanel from './PostgresSqlPanel.vue'
import { crumbSegments } from '../../../utils/crumbSegments'

const props = defineProps({
  activeTab: { type: Object, required: true },
})

const items = computed(() => crumbSegments({ connection: props.activeTab.connectionName, target: props.activeTab.target }))
</script>

<template>
  <PostgresSqlPanel v-model:sql="activeTab.state.sql" :run="activeTab.runtime.run">
    <WorkspaceCrumbs engine="postgresql" :items="items" />
  </PostgresSqlPanel>
</template>
