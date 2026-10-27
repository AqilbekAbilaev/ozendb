<script setup>
// The MongoDB collection workspace: find, aggregate, and SQL-to-MQL query behavior and
// rendering. What it does with the query lives in useCollectionRun, which runs it
// itself; this component renders it. The host (WorkspaceArea.vue) owns the tab bar, other
// pane kinds, the saved-query browser, and the result sub-tab compatibility ref this
// component reads/writes via v-model.
import QueryBar from '../../query/QueryBar.vue'
import SqlQueryBar from '../../query/SqlQueryBar.vue'
import PipelineEditor from '../../query/PipelineEditor.vue'
import ResultsPanel from '../../results/ResultsPanel.vue'
import CollectionCrumbs from '../../../../components/base/CollectionCrumbs.vue'
import { computed } from 'vue'
import { useInitialFindRun } from './useInitialFindRun'
import { useCollectionRun } from './useCollectionRun'
import { apiTarget } from '../../api/payload'
import { runQuery as runFind } from './queryRunner'

const props = defineProps({
  activeTab:        { type: Object, required: true },
  tabs:             { type: Array,  required: true },
  activeTabId:      { type: String, required: true },
  resultTab:        { type: String, required: true },
  savedQueryRequest: { type: Object, default: null },
})
const emit = defineEmits(['update:result-tab', 'open-query-browser', 'saved-query-applied'])

useInitialFindRun(computed(() => props.activeTab), {
  runQuery: (workspace, query) => runFind(workspace.id, query),
})

const {
  isAggregate, isSql, runValid, queryErrorText, pipelineErrorText,
  run, runQuery, selectRtab, onExplainVerbosity, cancel, followReference,
} = useCollectionRun({
  activeTab:         () => props.activeTab,
  tabs:              () => props.tabs,
  resultTab:         () => props.resultTab,
  savedQueryRequest: () => props.savedQueryRequest,
}, emit)

// The breadcrumb's names, read off the tab's ref.
const names = computed(() => apiTarget(props.activeTab.target))
</script>

<template>
  <!-- Breadcrumb -->
  <CollectionCrumbs :conn="activeTab.connectionName" :db="names.database" :coll="names.collection" />

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
    @cancel="cancel"
    @follow-reference="followReference"
  />

</template>
