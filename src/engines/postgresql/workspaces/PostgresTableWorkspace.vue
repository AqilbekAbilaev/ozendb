<script setup>
import { ref, reactive, shallowRef, watch, computed } from 'vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import CodeEditor from '../../../components/base/CodeEditor.vue'
import NumberStepper from '../../../components/base/NumberStepper.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import TabStrip from '../../../components/base/TabStrip.vue'
import PostgresMessages from './PostgresMessages.vue'
import PostgresQueryBuilder from './PostgresQueryBuilder.vue'
import PostgresResultGrid from './PostgresResultGrid.vue'
import PostgresSqlPanel from './PostgresSqlPanel.vue'
import PostgresTableFooter from './PostgresTableFooter.vue'
import PostgresTableHeader from './PostgresTableHeader.vue'
import { usePostgresTable } from './usePostgresTable.js'
import { openConnections } from '../../../stores/openConnections'
import { showToast } from '../../../stores/toast'

const props = defineProps({
  activeTab: { type: Object, required: true },
})

// The host reuses this component when switching between two table tabs, so the
// state is rebuilt whenever the tab changes rather than created once.
const t = shallowRef(null)
const limitDraft = ref(0)
const rtab = ref('Result')
const builderOpen = ref(false)
watch(() => props.activeTab.id, () => {
  const { connectionId, schema, table } = props.activeTab
  const readOnly = !!openConnections.value.find(c => c.id === connectionId)?.read_only
  t.value = reactive(usePostgresTable({ connectionId, schema, table }, { readOnly }))
  limitDraft.value = t.value.limit
  rtab.value = 'Result'
  t.value.load()
}, { immediate: true })

const SOON = 'Coming soon'
const rtabs = computed(() => [
  { value: 'Result', label: 'Result', count: t.value.rows.length },
  { value: 'Query Code', label: 'Query Code' },
  { value: 'Messages', label: 'Messages', count: t.value.messages.length },
  { value: 'Explain', label: 'Explain', disabled: true, title: SOON },
])

const run = () => t.value.applyFilters(limitDraft.value)

function switchMode(mode) {
  if (mode === t.value.mode) return
  if (mode === 'sql') t.value.toSql()
  else t.value.toFilters()
}

function copySql() {
  navigator.clipboard.writeText(t.value.currentSql).then(() => showToast('SQL copied')).catch(() => {})
}
</script>

<template>
  <div class="pg-table">
    <PostgresTableHeader :active-tab="activeTab" :mode="t.mode" @mode="switchMode" />

    <template v-if="t.mode === 'sql'">
      <div v-if="t.filterRefusal" class="pg-edit-error">Can't show this as filters: {{ t.filterRefusal }}</div>
      <PostgresSqlPanel :state="t.sqlState" :server="t.server" />
    </template>
    <template v-else>
      <div class="pg-toolbar">
        <BaseButton variant="ghost" icon="run" class="run" :disabled="t.loading" title="Apply the filters and limit (Enter)" @click="run">Run</BaseButton>
        <BaseButton variant="ghost" icon="exScan" disabled :title="SOON">Explain</BaseButton>
        <span class="qsep"></span>
        <BaseButton variant="ghost" icon="load" disabled :title="SOON" />
        <BaseButton variant="ghost" icon="save" disabled :title="SOON" />
        <BaseButton variant="ghost" icon="history" disabled :title="SOON" />
        <BaseButton variant="ghost" icon="copy" title="Copy SQL" @click="copySql" />
        <BaseButton v-if="t.activeFilters" variant="ghost" icon="close" title="Show every row again" @click="t.clearFilters">
          Clear ({{ t.activeFilters }})
        </BaseButton>
        <span class="spacer"></span>
        <span class="lbl">Limit</span>
        <NumberStepper v-model="limitDraft" :min="1" @enter="run" />
        <BaseButton bordered icon="aggregate" :active="builderOpen" title="Visual Query Builder" @click="builderOpen = !builderOpen">Query Builder</BaseButton>
      </div>

      <div class="pg-body">
        <PostgresQueryBuilder
          v-if="builderOpen && t.columns.length"
          :table="activeTab.table"
          :columns="t.columns"
          :column-info="t.columnInfo"
          :filter-text="t.filterText"
          :order-by="t.orderBy"
          :descending="t.descending"
          :shown-columns="t.shownColumns"
          @filter-text="t.replaceFilterText"
          @columns="t.setShownColumns"
          @sort="t.setSort"
          @close="builderOpen = false"
        />
        <div class="rtabs">
          <TabStrip v-model="rtab" :options="rtabs" />
        </div>

        <template v-if="rtab === 'Result'">
          <div v-if="t.editError" class="pg-edit-error">{{ t.editError }}</div>
          <!-- Once the grid has columns, a failure (usually a filter value the column's type
               can't read) keeps it on screen, so the filter can be corrected in place. -->
          <div v-if="t.error && t.columns.length" class="pg-edit-error">{{ t.error }}</div>

          <StateMessage v-if="t.error && !t.columns.length" mode="error" :message="t.error" retryable @retry="t.load" />
          <StateMessage v-else-if="t.loading && !t.columns.length" mode="loading" />
          <StateMessage v-else-if="!t.rows.length && !t.activeFilters && !t.error" mode="empty" label="This table has no rows" />
          <PostgresResultGrid
            v-else
            :columns="t.view.columns"
            :rows="t.view.rows"
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
            @apply-filters="run"
          />
        </template>
        <div v-else-if="rtab === 'Query Code'" class="qcode">
          <div class="qcode-bar">
            <span>Generated from the column filters</span>
            <span class="spacer"></span>
            <BaseButton variant="ghost" icon="copy" @click="copySql">Copy</BaseButton>
            <BaseButton variant="primary" icon="sql" @click="switchMode('sql')">Open in SQL editor</BaseButton>
          </div>
          <CodeEditor :model-value="t.currentSql" readonly language="sql" class="qcode-sql" />
        </div>
        <PostgresMessages v-else :messages="t.messages" />
      </div>

      <PostgresTableFooter :t="t" />
    </template>
  </div>
</template>

<style scoped>
.pg-table { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.pg-toolbar {
  display: flex; align-items: center; gap: 2px; flex: none;
  padding: 3px 10px; border-bottom: 1px solid var(--border);
}
.pg-toolbar .run :deep(svg) { color: var(--green); }
.qsep { width: 1px; height: 18px; margin: 0 6px; background: var(--border-soft); }
.lbl { margin-right: 6px; font-size: 12px; color: var(--text-dim); }
.pg-toolbar > .lbl + * { margin-right: 8px; }
.spacer { flex: 1; }
.pg-body { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; }
.rtabs { display: flex; flex: none; border-bottom: 1px solid var(--border); }
.qcode { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.qcode-bar {
  display: flex; align-items: center; gap: 4px; flex: none;
  padding: 5px 10px 5px 14px; font-size: 12px; color: var(--text-faint);
  border-bottom: 1px solid var(--border);
}
.qcode-sql { flex: 1; min-height: 0; }
.pg-edit-error {
  padding: 6px 10px; font-size: 12.5px;
  color: var(--danger-text); background: var(--danger-bg);
}
</style>
