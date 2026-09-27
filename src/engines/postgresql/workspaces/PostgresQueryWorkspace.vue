<script setup>
import EngineBadge from '../../../components/base/EngineBadge.vue'
import PostgresSqlPanel from './PostgresSqlPanel.vue'

defineProps({
  activeTab: { type: Object, required: true },
})
</script>

<template>
  <PostgresSqlPanel :state="activeTab">
    <div class="pg-crumbs">
      <EngineBadge engine="postgresql" />
      <span class="pg-name">{{ activeTab.connectionName }} · {{ activeTab.database }}</span>
    </div>
  </PostgresSqlPanel>
</template>

<style scoped>
.pg-crumbs {
  display: flex; align-items: center; gap: 7px; flex: none; min-height: 34px;
  padding: 4px 14px; font-size: 12.5px; border-bottom: 1px solid var(--border);
}
.pg-name { color: var(--text); }
</style>
