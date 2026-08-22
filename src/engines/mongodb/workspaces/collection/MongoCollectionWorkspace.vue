<script setup>
// The MongoDB collection workspace: find, aggregate, and SQL-to-MQL query behavior
// and rendering, extracted whole from QueryWorkspace.vue (Work 3). It owns parsing,
// validation, run dispatch, explain, and the saved-query browser for *collection*
// tabs, and mutates the existing flat tab fields exactly as before. The host
// (QueryWorkspace.vue) owns the tab bar, other pane kinds, and the result sub-tab
// compatibility ref this component reads/writes via v-model.
import { ref, computed, nextTick, watch } from 'vue'
import { translateSqlToMql, explainFind, explainAggregate, loadExplainStorage } from '../../api/queries'
import { errText } from '../../../../utils/errors'
import QueryBar from '../../../../components/query/QueryBar.vue'
import SqlQueryBar from '../../../../components/query/SqlQueryBar.vue'
import PipelineEditor from '../../../../components/query/PipelineEditor.vue'
import ResultsPanel from '../../../../components/results/ResultsPanel.vue'
import QueryBrowserModal from '../../../../components/query/QueryBrowserModal.vue'
import CollectionCrumbs from '../../../../components/base/CollectionCrumbs.vue'
import { parseField, parsePipeline } from '../../../../utils/queryParser'
import { setCollectionQueryMode } from '../../../../utils/queryMode'

const props = defineProps({
  activeTab:        { type: Object, required: true },
  tabs:             { type: Array,  required: true },
  activeTabId:      { type: String, required: true },
  resultTab:        { type: String, required: true },
  vqbOpen:          { type: Boolean, default: false },
  clipboardQuery:   { type: Object, default: null },
  docMenuRequest:   { type: Object, default: null },
  historyRequest:   { type: Object, default: null },
  browserRequest:   { type: Object, default: null },
  saveQueryRequest: { type: Object, default: null },
})
const emit = defineEmits([
  'update:result-tab', 'run-query', 'run-aggregate',
  'toggle-vqb', 'open-vqb', 'close-vqb', 'copy-query', 'paste-query',
  'cancel-query', 'follow-reference',
])

const showQueryBrowser = ref(false)

const activeTab = computed(() => props.activeTab)
const isAggregate = computed(() => activeTab.value && activeTab.value.mode === 'aggregate')
const isSql = computed(() => activeTab.value && activeTab.value.mode === 'sql')

// ── query parsing & validation ─────────────────────────────
// Shell syntax is parsed to canonical Extended JSON by utils/queryParser.js (MongoDB's
// own parser), which the Rust backend decodes to BSON. Fields are parsed live so we can
// show an inline error and disable Run while the query is invalid, instead of silently
// sending corrupted JSON.
const parsedQuery = computed(() => {
  const tab = activeTab.value
  if (!tab || tab.kind !== 'collection') return null
  return {
    filter:     parseField(tab.filter),
    projection: parseField(tab.projection),
    sort:       parseField(tab.sort),
  }
})
const parsedPipeline = computed(() => {
  const tab = activeTab.value
  if (!tab || tab.kind !== 'collection') return null
  return parsePipeline(tab.pipeline)
})
const queryValid = computed(() => {
  const p = parsedQuery.value
  return !p || (p.filter.ok && p.projection.ok && p.sort.ok)
})
const pipelineValid = computed(() => {
  const p = parsedPipeline.value
  return !p || p.ok
})
// SQL validity is checked by the backend on translate, so the Run button is never
// gated here for sql mode; find/aggregate gate on their parsed input as before.
const runValid = computed(() =>
  isSql.value ? true : (isAggregate.value ? pipelineValid.value : queryValid.value))
// First offending field's message, shown under the query area / pipeline editor.
const queryErrorText = computed(() => {
  const p = parsedQuery.value
  if (!p) return null
  if (!p.filter.ok) return 'Query: ' + p.filter.error
  if (!p.projection.ok) return 'Projection: ' + p.projection.error
  if (!p.sort.ok) return 'Sort: ' + p.sort.error
  return null
})
const pipelineErrorText = computed(() => {
  const p = parsedPipeline.value
  if (!p || p.ok) return null
  return 'Pipeline: ' + p.error
})

// The Run button (and the result toolbar's refresh) dispatch on the tab's mode.
function run() {
  if (isSql.value) {
    runSql()
  } else if (isAggregate.value) {
    runAggregate()
  } else {
    runQuery()
  }
}

// Translate the tab's SQL into a MongoDB find, then run it against the tab's
// collection. The translated pieces are stored on the tab (as canonical JSON) so
// the shared result stack — paging, the Query Code preview, and Explain — all
// operate on the same query. The collection is fixed by the tab; the collection
// named in the SQL FROM clause is intentionally ignored.
async function runSql() {
  const tab = activeTab.value
  if (!tab || tab.kind !== 'collection') return
  tab.sqlError = null
  let mql
  try {
    mql = await translateSqlToMql(tab.sql || '')
  } catch (e) {
    tab.sqlError = errText(e)
    return
  }
  tab.filter     = mql.filter
  tab.projection = mql.projection
  tab.sort       = mql.sort
  tab.skip       = mql.skip ?? 0
  tab.limit      = mql.limit ?? (tab.limit || 50)
  emit('run-query', tab.id, {
    filter:        mql.filter,
    projection:    mql.projection,
    sort:          mql.sort,
    skip:          tab.skip,
    limit:         tab.limit,
    addToHistory:  true,
  })
  if (props.resultTab === 'Explain') runExplain()
}

function runAggregate() {
  const tab = activeTab.value
  if (!tab || tab.kind !== 'collection') return
  const parsed = parsedPipeline.value
  if (!parsed || !parsed.ok) return  // inline error is already shown
  emit('run-aggregate', tab.id, { pipeline: parsed.ejson })
  // Keep the Explain plan in sync when it's the visible sub-tab.
  if (props.resultTab === 'Explain') runExplain()
}

function runQuery(addToHistory = true, tab = activeTab.value) {
  if (!tab || tab.kind !== 'collection') return
  expandIdFilter(tab)
  const parsed = {
    filter: parseField(tab.filter),
    projection: parseField(tab.projection),
    sort: parseField(tab.sort),
  }
  if (!parsed || !parsed.filter.ok || !parsed.projection.ok || !parsed.sort.ok) return
  emit('run-query', tab.id, {
    filter:        parsed.filter.ejson,
    projection:    parsed.projection.ejson,
    sort:          parsed.sort.ejson,
    skip:          tab.skip || 0,
    limit:         tab.limit || 50,
    addToHistory:  addToHistory,
  })
  // Keep the Explain plan in sync when it's the visible sub-tab.
  if (tab.id === activeTab.value?.id && props.resultTab === 'Explain') runExplain()
}

// Switch result sub-tab; the Explain plan is fetched lazily the first time it's
// shown (and re-fetched whenever the query re-runs while it's open).
function selectRtab(t) {
  emit('update:result-tab', t)
  if (t === 'Explain') runExplain()
}

async function runExplain() {
  const tab = activeTab.value
  if (!tab || tab.kind !== 'collection') return
  // The chosen verbosity is stored on the tab so re-runs (pagination, refresh) reuse it.
  const verbosity = tab.explainVerbosity || 'executionStats'
  tab.explainVerbosity = verbosity
  // Storage sizes (Collection/Index target nodes) are find-only and fetched separately.
  tab.explainStorage = null

  // Aggregate tabs explain their pipeline; find tabs explain the find query. Explaining
  // a find({}) on an aggregate tab (the old behavior) was silently misleading.
  if (tab.mode === 'aggregate') {
    const parsed = parsedPipeline.value || parsePipeline(tab.pipeline)
    if (!parsed || !parsed.ok) {
      tab.explainError = 'Fix the pipeline before running Explain.'
      tab.explainResult = null
      return
    }
    tab.explainRunning = true
    tab.explainError = null
    try {
      const result = await explainAggregate(
        { connectionId: tab.connectionId, database: tab.dbName, collection: tab.collectionName },
        parsed.ejson,
        verbosity,
      )
      tab.explainResult = result
    } catch (e) {
      tab.explainError = errText(e)
      tab.explainResult = null
    } finally {
      tab.explainRunning = false
    }
    return
  }

  const parsed = parsedQuery.value
  if (!parsed || !parsed.filter.ok || !parsed.projection.ok || !parsed.sort.ok) {
    tab.explainError = 'Fix the query before running Explain.'
    tab.explainResult = null
    return
  }
  tab.explainRunning = true
  tab.explainError = null
  try {
    const result = await explainFind(
      { connectionId: tab.connectionId, database: tab.dbName, collection: tab.collectionName },
      {
        filter:     parsed.filter.ejson,
        projection: parsed.projection.ejson,
        sort:       parsed.sort.ejson,
        skip:       tab.skip || 0,
        limit:      tab.limit || 50,
      },
      verbosity,
    )
    tab.explainResult = result
    // Best-effort: fetch on-disk sizes for the Collection/Index target nodes. A failure
    // here must never clear the explain or surface an error — just skip the size nodes.
    try {
      tab.explainStorage = await loadExplainStorage({
        connectionId: tab.connectionId,
        database:     tab.dbName,
        collection:   tab.collectionName,
      })
    } catch (e) {
      tab.explainStorage = null
    }
  } catch (e) {
    tab.explainError = errText(e)
    tab.explainResult = null
  } finally {
    tab.explainRunning = false
  }
}

// The Explain sub-tab's verbosity selector (in ResultsPanel) changed: store it and re-run.
function onExplainVerbosity(v) {
  const tab = activeTab.value
  if (!tab) return
  tab.explainVerbosity = v
  runExplain()
}

// When the whole Query value is a bare 24-hex ObjectId, build the _id filter so you
// can drop a copied id straight into the box. Done at run time (not on every
// keystroke) so the field stays a plain text input — rewriting its value on input is
// what defeats the browser's native undo/redo.
function expandIdFilter(tab) {
  const v = (tab.filter || '').trim()
  if (/^[0-9a-fA-F]{24}$/.test(v)) {
    tab.filter = `{ _id: ObjectId("${v}") }`
  }
}

function openQueryBrowser() {
  showQueryBrowser.value = true
}

// File → Load: open the saved-query browser on request from the native menu.
watch(() => props.browserRequest && props.browserRequest.nonce, (nonce) => {
  if (nonce == null) return
  openQueryBrowser()
})

async function applyFromBrowser(entry) {
  const tab = activeTab.value
  if (!tab) return
  if (entry.mode === 'aggregate') {
    setCollectionQueryMode(tab, 'aggregate')
    tab.pipeline = entry.pipeline
  } else {
    setCollectionQueryMode(tab, 'find')
    tab.filter     = entry.filter
    tab.sort       = entry.sort
    tab.projection = entry.projection
    tab.skip       = Number(entry.skip)
    tab.limit      = Number(entry.limit)
  }
  await nextTick()
  run()
}
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
      :vqb-open="vqbOpen"
      :clipboard-query="clipboardQuery"
      :history-request="historyRequest"
      :save-request="saveQueryRequest"
      @run="run"
      @copy-query="emit('copy-query')"
      @paste-query="emit('paste-query')"
      @toggle-vqb="emit('toggle-vqb')"
      @open-browser="openQueryBrowser"
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
    :vqb-open="vqbOpen"
    :tabs="tabs"
    :active-tab-id="activeTabId"
    :doc-menu-request="docMenuRequest"
    @run="run"
    @requery="runQuery"
    @select-rtab="selectRtab"
    @explain-verbosity="onExplainVerbosity"
    @open-vqb="emit('open-vqb')"
    @close-vqb="emit('close-vqb')"
    @cancel="activeTab && emit('cancel-query', activeTab.id)"
    @follow-reference="emit('follow-reference', $event)"
  />

  <QueryBrowserModal
    v-if="showQueryBrowser"
    @close="showQueryBrowser = false"
    @apply="applyFromBrowser"
  />
</template>
