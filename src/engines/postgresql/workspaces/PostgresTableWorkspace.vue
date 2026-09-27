<script setup>
import { ref, reactive, shallowRef, watch, computed } from 'vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import CodeEditor from '../../../components/base/CodeEditor.vue'
import NumberStepper from '../../../components/base/NumberStepper.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import TabStrip from '../../../components/base/TabStrip.vue'
import PostgresMessages from './PostgresMessages.vue'
import PostgresPlan from './PostgresPlan.vue'
import PostgresQueryLibrary from './PostgresQueryLibrary.vue'
import PostgresQueryBuilder from './PostgresQueryBuilder.vue'
import PostgresResultGrid from './PostgresResultGrid.vue'
import PostgresSqlPanel from './PostgresSqlPanel.vue'
import PostgresTableFooter from './PostgresTableFooter.vue'
import PostgresTableHeader from './PostgresTableHeader.vue'
import SegmentedControl from '../../../components/base/SegmentedControl.vue'
import { usePostgresTable } from './usePostgresTable.js'
import { tableSession } from './tableSessions.js'
import { openConnections } from '../../../stores/openConnections'
import { showToast } from '../../../stores/toast'

const props = defineProps({
  activeTab: { type: Object, required: true },
})

// The host reuses this component across table tabs, so which tab's state it shows
// follows the active tab.
const t = shallowRef(null)
const limitDraft = ref(0)
const rtab = ref('Result')
const builderOpen = ref(false)
const library = ref(null)   // which view of the query library is open, if any
// Each tab keeps its state for as long as it's open (see tableSessions), so coming
// back to it shows it as it was; only a tab seen for the first time loads.
watch(() => props.activeTab.id, (id) => {
  const { connectionId, schema, table, restoredView } = props.activeTab
  const readOnly = !!openConnections.value.find(c => c.id === connectionId)?.read_only
  let fresh = false
  t.value = tableSession(id, () => {
    fresh = true
    return reactive(usePostgresTable({ connectionId, schema, table }, { readOnly, initial: restoredView ?? {} }))
  })
  limitDraft.value = t.value.limit
  rtab.value = 'Result'
  if (fresh) t.value.load()
}, { immediate: true })

const MODES = [{ value: 'filter', label: 'Filter' }, { value: 'sql', label: 'SQL' }]
const rtabs = computed(() => [
  { value: 'Result', label: 'Result', count: t.value.rows.length },
  { value: 'Query Code', label: 'Query Code' },
  { value: 'Messages', label: 'Messages', count: t.value.messages.length },
  { value: 'Explain', label: 'Explain' },
])

const run = () => t.value.applyFilters(limitDraft.value)

function switchMode(mode) {
  if (mode === t.value.mode) return
  if (mode === 'sql') t.value.toSql()
  else t.value.toFilters()
}

function explain() {
  rtab.value = 'Explain'
  return t.value.explain()
}

function copySql() {
  navigator.clipboard.writeText(t.value.currentSql).then(() => showToast('SQL copied')).catch(() => {})
}
</script>

<template>
  <div class="pg-table">
    <PostgresTableHeader :active-tab="activeTab" />

    <template v-if="t.mode === 'sql'">
      <div v-if="t.filterRefusal" class="pg-edit-error">Can't show this as filters: {{ t.filterRefusal }}</div>
      <PostgresSqlPanel :state="t.sqlState" :server="t.server">
        <template #toolbar-start>
          <SegmentedControl class="mode-toggle" :model-value="t.mode" :options="MODES" @update:model-value="switchMode" />
        </template>
      </PostgresSqlPanel>
    </template>
    <template v-else>
      <div class="qbar">
        <SegmentedControl class="mode-toggle" :model-value="t.mode" :options="MODES" @update:model-value="switchMode" />
        <BaseButton variant="ghost" icon="run" class="run" :disabled="t.loading" title="Apply the filters and limit (Enter)" @click="run">{{ t.loading ? 'Running…' : 'Run' }}</BaseButton>
        <BaseButton variant="ghost" icon="exScan" :disabled="t.explainState.explaining" title="Show how PostgreSQL runs these filters" @click="explain">Explain</BaseButton>
        <span class="qsep"></span>
        <BaseButton variant="ghost" icon="load" class="qbar-hide-sm" title="Open a saved query" @click="library = 'saved'" />
        <BaseButton variant="ghost" icon="save" class="qbar-hide-sm" title="Save these filters' SQL" @click="library = 'saved'" />
        <BaseButton variant="ghost" icon="history" class="qbar-hide-sm" title="Queries run on this connection" @click="library = 'history'" />
        <BaseButton variant="ghost" icon="copy" class="qbar-hide-md" title="Copy SQL" @click="copySql" />
        <BaseButton v-if="t.activeFilters" variant="ghost" icon="close" title="Show every row again" @click="t.clearFilters">
          Clear ({{ t.activeFilters }})
        </BaseButton>
        <span class="qbar-spacer"></span>
        <span class="qlabel limit">Limit</span>
        <NumberStepper v-model="limitDraft" :min="1" @enter="run" />
        <BaseButton bordered icon="aggregate" class="qbar-hide-lg" :active="builderOpen" title="Visual Query Builder" @click="builderOpen = !builderOpen">Query Builder</BaseButton>
      </div>

      <div class="pg-body">
        <PostgresQueryBuilder
          v-if="builderOpen && t.columns.length"
          :table="activeTab.table"
          :columns="t.keys"
          :column-info="t.columnInfo"
          :filter-text="t.filterText"
          :order-by="t.orderBy"
          :descending="t.descending"
          :shown-columns="t.shownColumns"
          :joins="t.joins"
          :join-offers="t.joinOffers"
          :table-names="t.tableNames"
          @filter-text="t.replaceFilterText"
          @columns="t.setShownColumns"
          @add-join="t.addJoin"
          @join-kind="t.setJoinKind"
          @remove-join="t.removeJoin"
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
        <PostgresPlan
          v-else-if="rtab === 'Explain'"
          :plan="t.explainState.plan"
          :error="t.explainState.planError"
          :explaining="t.explainState.explaining"
        />
        <PostgresMessages v-else :messages="t.messages" />
      </div>

      <PostgresTableFooter :t="t" />
      <PostgresQueryLibrary
        v-if="library"
        :connection-id="activeTab.connectionId"
        :sql="t.currentSql"
        :view="library"
        @load="t.openSql"
        @close="library = null"
      />
    </template>
  </div>
</template>

<style scoped>
.pg-table { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.limit { margin-right: 6px; }
.limit + * { margin-right: 8px; }
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
<style scoped src="../../../components/workspace/WorkspaceToolbar.css"></style>
