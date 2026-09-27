<script setup>
import PostgresSqlPanel from './PostgresSqlPanel.vue'

defineProps({
  activeTab: { type: Object, required: true },
})
</script>

<template>
  <PostgresSqlPanel :state="activeTab">
    <span class="pg-name">{{ activeTab.connectionName }} · {{ activeTab.database }}</span>
  </PostgresSqlPanel>
</template>

<style scoped>
.pg-name { font-weight: 600; color: var(--text); }
</style>
