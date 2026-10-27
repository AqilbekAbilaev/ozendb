<script setup>
// The MongoDB collection workspace: find, aggregate, and SQL-to-MQL query behavior and
// rendering. What it does with the query lives in useCollectionRun, which runs it
// itself; this component renders it. The result sub-tab and the saved-query browser live
// in module-level stores, since both must outlive this pane unmounting on a tab switch.
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
import { collectionResultTab } from './resultTab'
import { useSavedQueryBrowser } from '../../query/useSavedQueryBrowser'
import { tabs, activeTabId } from '../../../../stores/tabs'

const props = defineProps({
  activeTab: { type: Object, required: true },
})
const savedQueryBrowser = useSavedQueryBrowser()

useInitialFindRun(computed(() => props.activeTab), {
  runQuery: (workspace, query) => runFind(workspace.id, query),
})

const {
  isAggregate, isSql, runValid, queryErrorText, pipelineErrorText,
  run, runQuery, selectRtab, onExplainVerbosity, cancel, followReference,
} = useCollectionRun({
  activeTab: () => props.activeTab,
  tabs:      () => tabs.value,
})

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
      @open-browser="savedQueryBrowser.open(activeTab)"
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
    :rtab="collectionResultTab"
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
