// Explain for a collection tab: the pipeline on an aggregate tab, the find query otherwise
// (explaining a find({}) on an aggregate tab was silently misleading). Results land on
// `tab.runtime`; `isCurrent(tab)` says whether the tab is still open, so a late response
// for a closed or re-run tab is dropped.
import { explainFind, explainAggregate, loadExplainStorage } from '../../api/queries'
import { errText } from '../../../../utils/errors'
import { parsePipeline } from '../../../../utils/queryParser'
import { beginWorkspaceRequest } from '../../../../utils/workspaceRequest'
import { parseFindQuery, findQueryValid, findArgs } from './collectionQuery'

export async function runExplain(tab, isCurrent) {
  const runtime = tab.runtime
  const request = beginWorkspaceRequest(tab, 'explain')
  const canApply = () => request.isCurrent() && isCurrent(tab)
  const target = { connectionId: tab.connectionId, database: tab.dbName, collection: tab.collectionName }
  // The chosen verbosity stays on the tab so re-runs (pagination, refresh) reuse it.
  const verbosity = runtime.explainVerbosity || 'executionStats'
  runtime.explainVerbosity = verbosity
  // Storage sizes (Collection/Index target nodes) are find-only and fetched separately.
  runtime.explainStorage = null

  const aggregate = tab.mode === 'aggregate'
  const pipeline = aggregate ? parsePipeline(tab.state.query.pipeline) : null
  const find = aggregate ? null : parseFindQuery(tab.state.query)
  if (aggregate ? !(pipeline && pipeline.ok) : !findQueryValid(find)) {
    runtime.explainError = aggregate ? 'Fix the pipeline before running Explain.' : 'Fix the query before running Explain.'
    runtime.explainResult = null
    runtime.explainRunning = false
    return
  }

  runtime.explainRunning = true
  runtime.explainError = null
  try {
    const result = aggregate
      ? await explainAggregate(target, pipeline.ejson, verbosity)
      : await explainFind(target, findArgs(tab.state.query, find), verbosity)
    if (!canApply()) return
    runtime.explainResult = result
    // Best-effort: on-disk sizes for a find's Collection/Index target nodes. A failure
    // here must never clear the explain or surface an error — the size nodes are skipped.
    if (!aggregate) {
      try {
        const storage = await loadExplainStorage(target)
        if (canApply()) runtime.explainStorage = storage
      } catch (e) {
        if (canApply()) runtime.explainStorage = null
      }
    }
  } catch (e) {
    if (canApply()) {
      runtime.explainError = errText(e)
      runtime.explainResult = null
    }
  } finally {
    if (canApply()) runtime.explainRunning = false
  }
}
