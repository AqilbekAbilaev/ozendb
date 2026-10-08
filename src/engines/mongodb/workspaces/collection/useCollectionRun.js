import { computed, nextTick, watch } from 'vue'
import { translateSqlToMql } from '../../api/queries'
import { parsePipeline } from '../../../../utils/queryParser'
import { setCollectionQueryMode } from '../../../../utils/queryMode'
import { runTranslatedSql } from '../../../../utils/sqlWorkspace'
import { refreshRequest } from '../../../../stores/menuRequests'
import { parseFindQuery, findQueryValid, findQueryError, pipelineError, expandIdFilter, findArgs } from './collectionQuery'
import { runExplain } from './runExplain'

// What MongoCollectionWorkspace does with its query: live validation, the Run button's
// dispatch on the tab's mode, Explain, and applying a saved query. Runs leave as the
// component's `run-query` / `run-aggregate` events, so the tab store stays the one place
// a query actually executes. Each input is a getter onto the component's props.
export function useCollectionRun({ activeTab: getActiveTab, tabs, resultTab, savedQueryRequest }, emit) {
  const activeTab = computed(getActiveTab)
  const isAggregate = computed(() => activeTab.value && activeTab.value.mode === 'aggregate')
  const isSql = computed(() => activeTab.value && activeTab.value.mode === 'sql')
  const isCollection = (tab) => !!tab && tab.kind === 'collection'
  const isOpen = (tab) => tabs().includes(tab)

  // Parsed live, so an invalid field shows its error and disables Run instead of
  // sending corrupted JSON.
  const parsedQuery = computed(() => isCollection(activeTab.value) ? parseFindQuery(activeTab.value.state.query) : null)
  const parsedPipeline = computed(() => isCollection(activeTab.value) ? parsePipeline(activeTab.value.state.query.pipeline) : null)
  // SQL validity is checked by the backend on translate, so Run is never gated for it.
  const runValid = computed(() => {
    if (isSql.value) return true
    if (isAggregate.value) return !parsedPipeline.value || parsedPipeline.value.ok
    return !parsedQuery.value || findQueryValid(parsedQuery.value)
  })
  const queryErrorText = computed(() => parsedQuery.value && findQueryError(parsedQuery.value))
  const pipelineErrorText = computed(() => pipelineError(parsedPipeline.value))

  const explainVisible = () => resultTab() === 'Explain'
  const explain = (tab = activeTab.value) => { if (isCollection(tab)) return runExplain(tab, isOpen) }

  // The Run button (and the result toolbar's refresh) dispatch on the tab's mode.
  function run(tab = activeTab.value) {
    if (!isCollection(tab)) return
    if (tab.mode === 'sql') runSql(tab)
    else if (tab.mode === 'aggregate') runAggregate(tab)
    else runQuery(true, tab)
  }

  // The translated pieces are stored on the tab, so paging, the Query Code preview and
  // Explain all work on the same query. The collection is fixed by the tab; the one named
  // in the SQL's FROM is deliberately ignored.
  async function runSql(tab = activeTab.value) {
    if (!isCollection(tab)) return
    await runTranslatedSql(tab, {
      translate: translateSqlToMql,
      runQuery: (workspace, query) => emit('run-query', workspace.id, query),
      runExplain: explain,
      explainVisible,
      isCurrent: workspace => isOpen(workspace) && workspace.mode === 'sql',
    })
  }

  function runAggregate(tab = activeTab.value) {
    if (!isCollection(tab)) return
    const parsed = parsePipeline(tab.state.query.pipeline)
    if (!parsed || !parsed.ok) return  // inline error is already shown
    emit('run-aggregate', tab.id, { pipeline: parsed.ejson })
    if (explainVisible()) explain(tab)
  }

  function runQuery(addToHistory = true, tab = activeTab.value) {
    if (!isCollection(tab)) return
    // At run time, not per keystroke: rewriting the field's value on input is what
    // defeats the browser's native undo/redo.
    tab.state.query.filter = expandIdFilter(tab.state.query.filter)
    const parsed = parseFindQuery(tab.state.query)
    if (!findQueryValid(parsed)) return
    emit('run-query', tab.id, { ...findArgs(tab.state.query, parsed), addToHistory: addToHistory })
    if (tab.id === activeTab.value?.id && explainVisible()) explain(tab)
  }

  // Switch result sub-tab; the Explain plan is fetched lazily the first time it's shown
  // (and re-fetched whenever the query re-runs while it's open).
  function selectRtab(t) {
    emit('update:result-tab', t)
    if (t === 'Explain') explain()
  }

  // The Explain sub-tab's verbosity selector changed: store it and re-run.
  function onExplainVerbosity(v) {
    const tab = activeTab.value
    if (!tab) return
    tab.runtime.explainVerbosity = v
    explain(tab)
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

  watch(() => savedQueryRequest()?.nonce, async (nonce) => {
    const request = savedQueryRequest()
    if (nonce == null || request.tabId !== activeTab.value?.id) return
    try {
      await applyFromBrowser(request.entry)
    } finally {
      emit('saved-query-applied', nonce)
    }
  }, { immediate: true })

  return {
    isAggregate, isSql, runValid, queryErrorText, pipelineErrorText,
    run, runQuery, runAggregate, runSql, selectRtab, onExplainVerbosity,
  }
}
