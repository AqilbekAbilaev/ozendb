import { computed, nextTick, watch } from 'vue'
import { translateSqlToMql } from '../../api/queries'
import { parsePipeline } from '../../query/queryParser'
import { setCollectionQueryMode } from '../../query/queryMode'
import { runTranslatedSql } from '../../query/sqlWorkspace'
import { refreshRequest } from '../../../../stores/menuRequests'
import { parseFindQuery, findQueryValid, findQueryError, pipelineError, expandIdFilter, findArgs } from './collectionQuery'
import { runExplain } from './runExplain'
import * as queryRunner from './queryRunner'
import { openCollectionTab } from '../../tabs'
import { workspaceIsCollection } from '../../../../workspaces/registry'
import { collectionResultTab } from './resultTab'
import { useSavedQueryBrowser } from '../../query/useSavedQueryBrowser'

// What MongoCollectionWorkspace does with its query: live validation, the Run button's
// dispatch on the tab's mode, Explain, cancelling, following a reference, and applying a
// saved query. Runs go to queryRunner, the one place a query actually executes. Each
// input is a getter onto the component's props.
export function useCollectionRun({ activeTab: getActiveTab, tabs }) {
  const activeTab = computed(getActiveTab)
  const isAggregate = computed(() => activeTab.value && activeTab.value.mode === 'aggregate')
  const isSql = computed(() => activeTab.value && activeTab.value.mode === 'sql')
  const isOpen = (tab) => tabs().includes(tab)

  // Parsed live, so an invalid field shows its error and disables Run instead of
  // sending corrupted JSON.
  const parsedQuery = computed(() => workspaceIsCollection(activeTab.value) ? parseFindQuery(activeTab.value.state.query) : null)
  const parsedPipeline = computed(() => workspaceIsCollection(activeTab.value) ? parsePipeline(activeTab.value.state.query.pipeline) : null)
  // SQL validity is checked by the backend on translate, so Run is never gated for it.
  const runValid = computed(() => {
    if (isSql.value) return true
    if (isAggregate.value) return !parsedPipeline.value || parsedPipeline.value.ok
    return !parsedQuery.value || findQueryValid(parsedQuery.value)
  })
  const queryErrorText = computed(() => parsedQuery.value && findQueryError(parsedQuery.value))
  const pipelineErrorText = computed(() => pipelineError(parsedPipeline.value))

  const savedQueryBrowser = useSavedQueryBrowser()
  const explainVisible = () => collectionResultTab.value === 'Explain'
  const explain = (tab = activeTab.value) => { if (workspaceIsCollection(tab)) return runExplain(tab, isOpen) }

  // The Run button (and the result toolbar's refresh) dispatch on the tab's mode.
  function run(tab = activeTab.value) {
    if (!workspaceIsCollection(tab)) return
    if (tab.mode === 'sql') runSql(tab)
    else if (tab.mode === 'aggregate') runAggregate(tab)
    else runQuery(true, tab)
  }

  // The translated pieces are stored on the tab, so paging, the Query Code preview and
  // Explain all work on the same query. The collection is fixed by the tab; the one named
  // in the SQL's FROM is deliberately ignored.
  async function runSql(tab = activeTab.value) {
    if (!workspaceIsCollection(tab)) return
    await runTranslatedSql(tab, {
      translate: translateSqlToMql,
      runQuery: (workspace, query) => queryRunner.runQuery(workspace.id, query),
      runExplain: explain,
      explainVisible,
      isCurrent: workspace => isOpen(workspace) && workspace.mode === 'sql',
    })
  }

  function runAggregate(tab = activeTab.value) {
    if (!workspaceIsCollection(tab)) return
    const parsed = parsePipeline(tab.state.query.pipeline)
    if (!parsed || !parsed.ok) return  // inline error is already shown
    queryRunner.runAggregate(tab.id, { pipeline: parsed.ejson })
    if (explainVisible()) explain(tab)
  }

  function runQuery(addToHistory = true, tab = activeTab.value) {
    if (!workspaceIsCollection(tab)) return
    // At run time, not per keystroke: rewriting the field's value on input is what
    // defeats the browser's native undo/redo.
    tab.state.query.filter = expandIdFilter(tab.state.query.filter)
    const parsed = parseFindQuery(tab.state.query)
    if (!findQueryValid(parsed)) return
    queryRunner.runQuery(tab.id, { ...findArgs(tab.state.query, parsed), addToHistory: addToHistory })
    if (tab.id === activeTab.value?.id && explainVisible()) explain(tab)
  }

  // Switch result sub-tab; the Explain plan is fetched lazily the first time it's shown
  // (and re-fetched whenever the query re-runs while it's open).
  function selectRtab(t) {
    collectionResultTab.value = t
    if (t === 'Explain') explain()
  }

  // The Explain sub-tab's verbosity selector changed: store it and re-run.
  function onExplainVerbosity(v) {
    const tab = activeTab.value
    if (!tab) return
    tab.runtime.explainVerbosity = v
    explain(tab)
  }

  function cancel() {
    if (activeTab.value) queryRunner.cancelQuery(activeTab.value.id)
  }

  // A cell's reference opens the collection it points at, in a tab of its own.
  function followReference(reference) {
    openCollectionTab(reference)
  }

  async function applyFromBrowser(entry) {
    const tab = activeTab.value
    if (!tab) return
    if (entry.mode === 'aggregate') {
      setCollectionQueryMode(tab, 'aggregate')
      tab.state.query.pipeline = entry.pipeline
    } else {
      setCollectionQueryMode(tab, 'find')
      tab.state.query.filter     = entry.filter
      tab.state.query.sort       = entry.sort
      tab.state.query.projection = entry.projection
      tab.state.query.skip       = Number(entry.skip)
      tab.state.query.limit      = Number(entry.limit)
    }
    await nextTick()
    run(tab)
  }

  // View → Refresh, which only reaches a find (see canRefreshWorkspace).
  watch(refreshRequest, () => run())

  watch(() => savedQueryBrowser.request.value?.nonce, async (nonce) => {
    const request = savedQueryBrowser.request.value
    if (nonce == null || request.tabId !== activeTab.value?.id) return
    try {
      await applyFromBrowser(request.entry)
    } finally {
      savedQueryBrowser.acknowledge(nonce)
    }
  }, { immediate: true })

  return {
    isAggregate, isSql, runValid, queryErrorText, pipelineErrorText,
    run, runQuery, runAggregate, runSql, selectRtab, onExplainVerbosity, cancel, followReference,
  }
}
