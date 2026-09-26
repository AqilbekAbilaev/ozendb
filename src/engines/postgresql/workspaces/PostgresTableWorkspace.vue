<script setup>
import { reactive, shallowRef, watch, computed } from 'vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import PostgresResultGrid from './PostgresResultGrid.vue'
import { usePostgresTable } from './usePostgresTable.js'

const props = defineProps({
  activeTab: { type: Object, required: true },
})

// The host reuses this component when switching between two table tabs, so the
// state is rebuilt whenever the tab changes rather than created once.
const t = shallowRef(null)
watch(() => props.activeTab.id, () => {
  const { connectionId, schema, table } = props.activeTab
  t.value = reactive(usePostgresTable({ connectionId, schema, table }))
  t.value.load()
}, { immediate: true })

const range = computed(() => {
  const { offset, rows, total } = t.value
  if (!rows.length) return '0 rows'
  return `${offset + 1}–${offset + rows.length} of ${total ?? '?'}`
})
</script>

<template>
  <div class="pg-table">
    <div class="pg-bar">
      <span class="pg-name">{{ activeTab.schema }}.{{ activeTab.table }}</span>
      <span class="spacer"></span>
      <span class="pg-range">{{ range }}</span>
      <BaseButton icon="prev" :disabled="!t.hasPrev || t.loading" title="Previous page" @click="t.prevPage" />
      <BaseButton icon="next" :disabled="!t.hasNext || t.loading" title="Next page" @click="t.nextPage" />
      <BaseButton icon="refresh" :disabled="t.loading" title="Refresh" @click="t.load" />
    </div>

    <div v-if="t.editError" class="pg-edit-error">{{ t.editError }}</div>

    <StateMessage v-if="t.error" mode="error" :message="t.error" retryable @retry="t.load" />
    <StateMessage v-else-if="t.loading && !t.rows.length" mode="loading" />
    <StateMessage v-else-if="!t.rows.length" mode="empty" label="This table has no rows" />
    <PostgresResultGrid
      v-else
      :columns="t.columns"
      :rows="t.rows"
      :order-by="t.orderBy"
      :descending="t.descending"
      sortable
      :can-edit="t.canEdit"
      @sort="t.sortBy"
      @save="t.saveCell"
    />
  </div>
</template>

<style scoped>
.pg-table { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.pg-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-bottom: 1px solid var(--border);
  background: var(--bg-toolbar);
}
.pg-name { font-weight: 600; color: var(--text); }
.pg-range { color: var(--text-dim); font-size: 12px; margin-right: 4px; }
.spacer { flex: 1; }
.pg-edit-error {
  padding: 6px 10px; font-size: 12.5px;
  color: var(--danger-text); background: var(--danger-bg);
}
</style>
