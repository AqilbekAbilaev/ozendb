<script setup>
// The MongoDB collection workspace: find, aggregate, and SQL-to-MQL query behavior and
// rendering. What it does with the query lives in useCollectionRun; this component
// renders it. The host (WorkspaceArea.vue) owns the tab bar, other pane kinds, and the
// result sub-tab compatibility ref this component reads/writes via v-model.
import QueryBar from '../../../../components/query/QueryBar.vue'
import SqlQueryBar from '../../../../components/query/SqlQueryBar.vue'
import PipelineEditor from '../../../../components/query/PipelineEditor.vue'
import ResultsPanel from '../../../../components/results/ResultsPanel.vue'
import CollectionCrumbs from '../../../../components/base/CollectionCrumbs.vue'
import { computed } from 'vue'
import { useInitialFindRun } from './useInitialFindRun'
import { useCollectionRun } from './useCollectionRun'

const props = defineProps({
  activeTab:        { type: Object, required: true },
  tabs:             { type: Array,  required: true },
  activeTabId:      { type: String, required: true },
  resultTab:        { type: String, required: true },
  savedQueryRequest: { type: Object, default: null },
})
const emit = defineEmits([
  'update:result-tab', 'run-query', 'run-aggregate',
  'cancel-query', 'follow-reference', 'open-query-browser', 'saved-query-applied',
])

useInitialFindRun(computed(() => props.activeTab), {
  runQuery: (workspace, query) => emit('run-query', workspace.id, query),
})

const {
  isAggregate, isSql, runValid, queryErrorText, pipelineErrorText,
  run, runQuery, selectRtab, onExplainVerbosity,
} = useCollectionRun({
  activeTab:         () => props.activeTab,
  tabs:              () => props.tabs,
  resultTab:         () => props.resultTab,
  savedQueryRequest: () => props.savedQueryRequest,
}, emit)
</script>

<template>
  <!-- Breadcrumb -->
  <CollectionCrumbs :conn="activeTab.connectionName" :db="activeTab.dbName" :coll="activeTab.collectionName" />

  <!-- SQL query bar (sql mode) -->
  <SqlQueryBar
    v-if="isSql"
    :active-tab="activeTab"
    :run-valid="runValid"
    :error-text="activeTab.sqlError"
    @run="run"
  />

  <!-- Query bar + find-mode inputs -->
  <template v-else>
    <QueryBar
      :active-tab="activeTab"
      :is-aggregate="isAggregate"
      :run-valid="runValid"
      :query-error-text="queryErrorText"
      @run="run"
      @open-browser="emit('open-query-browser')"
    />

    <!-- Aggregation pipeline editor -->
    <PipelineEditor
      v-if="isAggregate"
      :active-tab="activeTab"
      :pipeline-error-text="pipelineErrorText"
      @run="run"
    />
  </template>

  <!-- Results -->
  <ResultsPanel
    :active-tab="activeTab"
    :is-aggregate="isAggregate"
    :run-valid="runValid"
    :rtab="resultTab"
    :tabs="tabs"
    :active-tab-id="activeTabId"
    @run="run"
    @requery="runQuery"
    @select-rtab="selectRtab"
    @explain-verbosity="onExplainVerbosity"
    @cancel="activeTab && emit('cancel-query', activeTab.id)"
    @follow-reference="emit('follow-reference', $event)"
  />

</template>
