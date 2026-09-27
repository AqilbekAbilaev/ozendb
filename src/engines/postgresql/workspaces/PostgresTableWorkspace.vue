<script setup>
import { reactive, shallowRef, watch, computed } from 'vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import SegmentedControl from '../../../components/base/SegmentedControl.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import PostgresResultGrid from './PostgresResultGrid.vue'
import PostgresSqlPanel from './PostgresSqlPanel.vue'
import { usePostgresTable } from './usePostgresTable.js'
import { openConnections } from '../../../stores/openConnections'

const props = defineProps({
  activeTab: { type: Object, required: true },
})

// The host reuses this component when switching between two table tabs, so the
// state is rebuilt whenever the tab changes rather than created once.
const t = shallowRef(null)
watch(() => props.activeTab.id, () => {
  const { connectionId, schema, table } = props.activeTab
  const readOnly = !!openConnections.value.find(c => c.id === connectionId)?.read_only
  t.value = reactive(usePostgresTable({ connectionId, schema, table }, { readOnly }))
  t.value.load()
}, { immediate: true })

const modes = computed(() => [
  {
    value: 'filter',
    label: 'Filter',
    disabled: !t.value.canUseFilters,
    title: t.value.canUseFilters ? '' : 'The SQL was edited, so it no longer matches the filters',
  },
  { value: 'sql', label: 'SQL' },
])

function switchMode(mode) {
  if (mode === t.value.mode) return
  if (mode === 'sql') t.value.toSql()
  else t.value.toFilters()
}

const range = computed(() => {
  const { offset, rows, total } = t.value
  if (!rows.length) return '0 rows'
  return `${offset + 1}–${offset + rows.length} of ${total ?? '?'} rows`
})
</script>

<template>
  <div class="pg-table">
    <div class="pg-crumbs">
      <BaseIcon name="connect" :size="15" class="c-ic" />
      <span>{{ activeTab.connectionName }}</span>
      <BaseIcon name="caret" :size="11" class="c-ic" />
      <BaseIcon name="dbSmall" :size="15" class="c-ic" />
      <span>{{ activeTab.database }}</span>
      <BaseIcon name="caret" :size="11" class="c-ic" />
      <BaseIcon name="folder" :size="15" class="c-ic" />
      <span>{{ activeTab.schema }}</span>
      <BaseIcon name="caret" :size="11" class="c-ic" />
      <BaseIcon name="collSmall" :size="15" class="c-ic" />
      <span class="pg-name">{{ activeTab.table }}</span>
      <span class="spacer"></span>
      <template v-if="t.mode === 'filter'">
        <BaseButton v-if="t.activeFilters" icon="close" title="Show every row again" @click="t.clearFilters">
          Clear filters ({{ t.activeFilters }})
        </BaseButton>
        <BaseButton icon="refresh" :disabled="t.loading" title="Refresh" @click="t.refresh" />
      </template>
      <SegmentedControl :model-value="t.mode" :options="modes" @update:model-value="switchMode" />
    </div>

    <PostgresSqlPanel v-if="t.mode === 'sql'" :state="t.sqlState" />
    <template v-else>
      <div v-if="t.editError" class="pg-edit-error">{{ t.editError }}</div>
      <!-- Once the grid has columns, a failure (usually a filter value the column's type
           can't read) keeps it on screen, so the filter can be corrected in place. -->
      <div v-if="t.error && t.columns.length" class="pg-edit-error">{{ t.error }}</div>

      <StateMessage v-if="t.error && !t.columns.length" mode="error" :message="t.error" retryable @retry="t.load" />
      <StateMessage v-else-if="t.loading && !t.columns.length" mode="loading" />
      <StateMessage v-else-if="!t.rows.length && !t.activeFilters && !t.error" mode="empty" label="This table has no rows" />
      <PostgresResultGrid
        v-else
        :columns="t.columns"
        :rows="t.rows"
        :column-info="t.columnInfo"
        :row-offset="t.offset"
        :order-by="t.orderBy"
        :descending="t.descending"
        sortable
        :can-edit="t.canEdit"
        :edit-text="t.editText"
        :filter-text="t.filterText"
        @sort="t.sortBy"
        @save="t.saveCell"
        @filter-text="t.setFilterText"
        @apply-filters="t.applyFilters"
      />

      <div class="pg-footer">
        <span>{{ range }}</span>
        <span v-if="t.elapsedMs != null" class="fitem"><BaseIcon name="clock" :size="14" /> {{ t.elapsedMs }} ms</span>
        <span class="spacer"></span>
        <BaseButton icon="prev" :disabled="!t.hasPrev || t.loading" title="Previous page" @click="t.prevPage" />
        <BaseButton icon="next" :disabled="!t.hasNext || t.loading" title="Next page" @click="t.nextPage" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.pg-table { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.pg-crumbs, .pg-footer {
  display: flex; align-items: center; gap: 7px; flex: none;
  padding: 4px 10px 4px 14px; font-size: 12.5px; color: var(--text-dim);
}
.pg-crumbs { border-bottom: 1px solid var(--border); }
.pg-footer { gap: 16px; font-size: 12px; border-top: 1px solid var(--border); }
.c-ic { color: var(--text-faint); }
.pg-name { color: var(--text); }
.fitem { display: flex; align-items: center; gap: 6px; }
.spacer { flex: 1; }
.pg-edit-error {
  padding: 6px 10px; font-size: 12.5px;
  color: var(--danger-text); background: var(--danger-bg);
}
</style>
