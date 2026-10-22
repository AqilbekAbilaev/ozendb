<script setup>
import { computed } from 'vue'
import WorkspaceCrumbs from '../../../components/base/WorkspaceCrumbs.vue'
import SqlPanel from './SqlPanel.vue'
import { crumbSegments } from '../../../utils/crumbSegments'

const props = defineProps({
  activeTab: { type: Object, required: true },
})

const items = computed(() => crumbSegments({ connection: props.activeTab.connectionName, target: props.activeTab.target }))
</script>

<template>
  <SqlPanel v-model:sql="activeTab.state.sql" :run="activeTab.runtime.run">
    <WorkspaceCrumbs :engine="activeTab.engine" :items="items" />
  </SqlPanel>
</template>
