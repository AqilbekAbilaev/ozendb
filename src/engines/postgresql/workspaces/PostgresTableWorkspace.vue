<script setup>
import { ref, reactive, shallowRef, watch, computed } from 'vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import CodeEditor from '../../../components/base/CodeEditor.vue'
import NumberStepper from '../../../components/base/NumberStepper.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import TabStrip from '../../../components/base/TabStrip.vue'
import PostgresMessages from './PostgresMessages.vue'
import PostgresPlan from './PostgresPlan.vue'
import PostgresQueryLibrary from './PostgresQueryLibrary.vue'
import PostgresQueryBuilder from './PostgresQueryBuilder.vue'
import PostgresResultGrid from './PostgresResultGrid.vue'
import PostgresReviewSqlModal from './PostgresReviewSqlModal.vue'
import PostgresSqlPanel from './PostgresSqlPanel.vue'
import PostgresTableFooter from './PostgresTableFooter.vue'
import PostgresTableHeader from './PostgresTableHeader.vue'
import Resizer from '../../../components/base/Resizer.vue'
import SegmentedControl from '../../../components/base/SegmentedControl.vue'
import { usePostgresTable } from './usePostgresTable.js'
import { openConnections } from '../../../stores/openConnections'
import { showToast } from '../../../stores/toast'
import { refreshRequest } from '../../../stores/menuRequests'
import { openModal } from '../../../stores/modals'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'

const props = defineProps({
  activeTab: { type: Object, required: true },
})

// The host reuses this component across table tabs, so which tab it shows follows the
// active tab. Everything the tab holds is on the tab itself, so coming back to it shows
// it as it was; only a tab that has never loaded loads.
const t = shallowRef(null)
const limitDraft = ref(0)
const library = ref(null)   // which view of the query library is open, if any
watch(() => props.activeTab.id, () => {
  const readOnly = !!openConnections.value.find(c => c.id === props.activeTab.connectionId)?.read_only
  t.value = reactive(usePostgresTable(props.activeTab, { readOnly }))
  limitDraft.value = t.value.limit
  if (props.activeTab.runtime.generation === 0) t.value.load()
}, { immediate: true })
// View → Refresh, which only reaches Filter mode (see canRefreshWorkspace).
watch(refreshRequest, () => t.value.refresh())

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
  t.value.panel.rtab = 'Explain'
  return t.value.explain()
}

function copySql() {
  navigator.clipboard.writeText(t.value.currentSql).then(() => showToast('SQL copied')).catch(() => {})
}

// The loaded page plus any staged draft rows, appended after it — a draft's grid
// index is always past the loaded page's own length (see tableStage.js's canEdit/
// stageEdit, which route on that same boundary).
const gridRows = computed(() => [...t.value.view.rows, ...t.value.insertRows])

function rowStatus(rowIndex) {
  if (rowIndex >= t.value.rows.length) return 'inserted'
  return t.value.isDeleted(rowIndex) ? 'deleted' : null
}

// Rows the grid currently has selected, whether a range/multi-select or just the one
// active cell's row — the same fallback the grid's own copySelection uses.
const selectedRowIndexes = computed(() => {
  const sel = t.value.selection
  return sel.selectedRows.length ? sel.selectedRows : (sel.selectedRow >= 0 ? [sel.selectedRow] : [])
})
const canDuplicate = computed(() => selectedRowIndexes.value.length === 1 && selectedRowIndexes.value[0] < t.value.rows.length)

const resultGridRef = ref(null)
function onAddRow() {
  const key = t.value.addRow()
  if (key == null) return
  const rowIndex = t.value.rows.length + t.value.insertDrafts.length - 1
  resultGridRef.value?.focusNewRow(rowIndex)
}

function deleteSelection() {
  t.value.toggleDelete(selectedRowIndexes.value)
}

function duplicateSelection() {
  if (canDuplicate.value) t.value.duplicateRow(selectedRowIndexes.value[0])
}

// One row or several, loaded or draft — restoreRow/removeInsert both already no-op
// safely on a row with nothing staged, so this doesn't need to know which kind first.
function restoreSelection() {
  for (const idx of selectedRowIndexes.value) {
    if (idx >= t.value.rows.length) {
      const draft = t.value.insertDrafts[idx - t.value.rows.length]
      if (draft) t.value.removeInsert(draft.key)
    } else {
      t.value.restoreRow(idx)
    }
  }
}

const reviewSqlOpen = ref(false)
const saving = ref(false)
async function saveChanges() {
  if (saving.value) return
  saving.value = true
  try {
    if (await t.value.saveChanges()) showToast('Changes saved')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="pg-table">
    <PostgresTableHeader :active-tab="activeTab" />

    <template v-if="t.mode === 'sql'">
      <div v-if="t.filterRefusal" class="pg-edit-error">Can't show this as filters: {{ t.filterRefusal }}</div>
      <PostgresSqlPanel v-model:sql="t.sql" :run="t.sqlRun" :server="t.server">
        <template #toolbar-start>
          <SegmentedControl class="mode-toggle" :model-value="t.mode" :options="MODES" @update:model-value="switchMode" />
        </template>
      </PostgresSqlPanel>
    </template>
    <template v-else>
      <div class="qbar">
        <SegmentedControl class="mode-toggle" :model-value="t.mode" :options="MODES" @update:model-value="switchMode" />
        <BaseButton variant="ghost" icon="run" class="run" :disabled="t.loading" title="Apply the filters and limit (Enter)" @click="run">{{ t.loading ? 'Running…' : 'Run' }}</BaseButton>
        <BaseButton variant="ghost" icon="exScan" :disabled="t.explainRun.explaining" title="Show how PostgreSQL runs these filters" @click="explain">Explain</BaseButton>
        <span class="qsep"></span>
        <BaseButton variant="ghost" icon="load" class="qbar-hide-sm" title="Open a saved query" @click="library = 'saved'" />
        <BaseButton variant="ghost" icon="save" class="qbar-hide-sm" title="Save these filters' SQL" @click="library = 'saved'" />
        <BaseButton variant="ghost" icon="history" class="qbar-hide-sm" title="Queries run on this connection" @click="library = 'history'" />
        <BaseButton variant="ghost" icon="undo" class="qbar-hide-sm" title="Row edit history for this table" @click="openModal('pgRowHistory', t.target)" />
        <BaseButton variant="ghost" icon="copy" class="qbar-hide-md" title="Copy SQL" @click="copySql" />
        <BaseButton v-if="t.activeFilters" variant="ghost" icon="close" title="Show every row again" @click="t.clearFilters">
          Clear ({{ t.activeFilters }})
        </BaseButton>
        <FlexSpacer />
        <span class="qlabel limit">Limit</span>
        <NumberStepper v-model="limitDraft" :min="1" @enter="run" />
        <BaseButton bordered icon="aggregate" class="qbar-hide-lg" :active="t.panel.builderOpen" title="Visual Query Builder" @click="t.panel.builderOpen = !t.panel.builderOpen">Query Builder</BaseButton>
      </div>

      <div class="pg-body">
        <div class="pg-main">
          <div class="rtabs">
            <TabStrip v-model="t.panel.rtab" :options="rtabs" />
          </div>

          <div class="stagebar">
            <BaseButton icon="first" :icon-size="18" :disabled="!t.hasPrev || t.loading" title="First page" @click="t.firstPage" />
            <BaseButton icon="prev" :icon-size="18" :disabled="!t.hasPrev || t.loading" title="Previous page" @click="t.prevPage" />
            <BaseButton icon="next" :icon-size="18" :disabled="!t.hasNext || t.loading" title="Next page" @click="t.nextPage" />
            <BaseButton icon="last" :icon-size="18" :disabled="!t.hasNext || t.loading" title="Last page" @click="t.lastPage" />
            <BaseButton
              icon="lock" :icon-size="18" :active="t.tabReadOnly"
              :title="t.tabReadOnly ? 'Read-only mode is on — click to allow edits' : 'Read-only mode (block accidental edits)'"
              @click="t.tabReadOnly = !t.tabReadOnly"
            />
            <BaseButton icon="plus" :icon-size="18" :disabled="t.tabReadOnly" title="Add a new row" @click="onAddRow" />
            <BaseButton icon="duplicate" :icon-size="18" :disabled="t.tabReadOnly || !canDuplicate" title="Duplicate the selected row" @click="duplicateSelection" />
            <BaseButton icon="trash" :icon-size="18" :disabled="t.tabReadOnly || !selectedRowIndexes.length" title="Mark the selected row(s) for deletion" @click="deleteSelection" />
            <BaseButton icon="undo" :icon-size="18" :disabled="!selectedRowIndexes.length" title="Undo the selected row's pending change" @click="restoreSelection" />
            <span v-if="t.deletedCount" class="stage-deleted"><BaseIcon name="trash" :size="12" /> {{ t.deletedCount }} deleted</span>
            <FlexSpacer />
            <template v-if="t.pendingCount || saving">
              <BaseButton icon="sql" :icon-size="18" :disabled="!t.pendingCount" title="Preview the SQL a save will run" @click="reviewSqlOpen = true" />
              <BaseButton icon="close" :icon-size="18" :disabled="!t.pendingCount" title="Drop every pending change" @click="t.discardAll()" />
              <BaseButton
                variant="primary" icon="save" :disabled="!t.pendingCount || saving || t.tabReadOnly"
                :title="t.tabReadOnly ? 'This tab is read-only' : 'Run every pending change'" @click="saveChanges"
              >
                {{ saving ? 'Saving…' : `Save changes${t.pendingCount ? ' (' + t.pendingCount + ')' : ''}` }}
              </BaseButton>
            </template>
          </div>

          <template v-if="t.panel.rtab === 'Result'">
            <div v-if="t.editError" class="pg-edit-error">{{ t.editError }}</div>
            <!-- Once the grid has columns, a failure (usually a filter value the column's type
                 can't read) keeps it on screen, so the filter can be corrected in place. -->
            <div v-if="t.error && t.columns.length" class="pg-edit-error">{{ t.error }}</div>

            <StateMessage v-if="t.error && !t.columns.length" mode="error" :message="t.error" retryable @retry="t.load" />
            <StateMessage v-else-if="t.loading && !t.columns.length" mode="loading" />
            <StateMessage v-else-if="!t.rows.length && !t.activeFilters && !t.error" mode="empty" label="This table has no rows" />
            <PostgresResultGrid
              v-else
              ref="resultGridRef"
              :columns="t.view.columns"
              :rows="gridRows"
              :selection="t.selection"
              :column-info="t.columnInfo"
              :row-offset="t.offset"
              :order-by="t.orderBy"
              :descending="t.descending"
              sortable
              reorderable
              :can-edit="t.canEdit"
              :edit-text="t.editText"
              :row-status="rowStatus"
              :filter-text="t.filterText"
              @sort="t.sortBy"
              @move-column="t.moveColumn"
              @save="t.stageEdit"
              @filter-text="t.setFilterText"
              @apply-filters="run"
            />
          </template>
          <div v-else-if="t.panel.rtab === 'Query Code'" class="qcode">
            <div class="qcode-bar">
              <span>Generated from the column filters</span>
              <FlexSpacer />
              <BaseButton variant="ghost" icon="copy" @click="copySql">Copy</BaseButton>
              <BaseButton variant="primary" icon="sql" @click="switchMode('sql')">Open in SQL editor</BaseButton>
            </div>
            <CodeEditor :model-value="t.currentSql" readonly language="sql" class="qcode-sql" />
          </div>
          <PostgresPlan
            v-else-if="t.panel.rtab === 'Explain'"
            :plan="t.explainRun.plan"
            :error="t.explainRun.planError"
            :explaining="t.explainRun.explaining"
          />
          <PostgresMessages v-else :messages="t.messages" />
        </div>
        <Resizer v-if="t.panel.builderOpen && t.columns.length" v-model="t.panel.builderWidth" axis="x" invert :min="280" :max="760" />
        <PostgresQueryBuilder
          v-if="t.panel.builderOpen && t.columns.length"
          :style="{ width: t.panel.builderWidth + 'px' }"
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
          :pauses="t.pauses"
          :join-choices="t.joinChoices"
          @filter-text="t.replaceFilterText"
          @columns="t.setShownColumns"
          @add-join="t.addJoin"
          @join-kind="t.setJoinKind"
          @remove-join="t.removeJoin"
          @join-on="t.setJoinOn"
          @sort="t.setSort"
          @paused-text="t.pauses.conditions = $event"
          @apply="run"
        />
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
      <PostgresReviewSqlModal v-if="reviewSqlOpen" :sql="t.reviewSql" @close="reviewSqlOpen = false" />
    </template>
  </div>
</template>

<style scoped>
.pg-table { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.limit { margin-right: 6px; }
.limit + * { margin-right: 8px; }
.pg-body { display: flex; flex: 1; min-height: 0; }
.pg-main { display: flex; flex-direction: column; flex: 1; min-width: 0; }
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
/* Staged-changes row (Add row/Duplicate/Delete/Restore, Review SQL/Discard/Save
   changes) — a second toolbar row under .rtabs, same look, its own concern. */
.stagebar { display: flex; align-items: center; gap: 4px; padding: 3px 8px; border-bottom: 1px solid var(--border); flex: none; }
.stage-deleted { display: flex; align-items: center; gap: 4px; font-size: 12.5px; color: var(--danger-text); margin-left: 6px; }
</style>
<style scoped src="../../../components/workspace/WorkspaceToolbar.css"></style>
