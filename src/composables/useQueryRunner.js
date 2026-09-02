import { markRaw } from 'vue'
import * as qapi from '../engines/mongodb/api/queries'
import { pushQueryHistory } from '../engines/mongodb/api/queryLibrary'
import { errText, errCode } from '../utils/errors'
import { tabs } from '../stores/tabs'

// Query execution: running find/aggregate queries against a tab and cancelling an
// in-flight query.
// Tabs come from the store, so this mutates the same tab objects every other consumer
// sees; `showToast` is still injected to surface the same toasts as before.
export function useQueryRunner({ showToast }) {
  // ── query execution ────────────────────────────────────────
  // A unique tag stamped on each query op (as its `comment`) so a cancel can find
  // and kill exactly that operation server-side.
  function newRunId() {
    return 'q' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  }

  // A response the tab has moved on from — cancelled, or overtaken by a newer run.
  // Killing the server op is best-effort (it may already have finished, with the
  // documents still travelling home), so the cancel has to be honoured here too:
  // whatever arrives for a stale run is dropped instead of rendered.
  function isStale(tab, runId) {
    return tab.cancelled || tab.runId !== runId
  }

  // Cancel a tab's in-flight query: stop showing it as running straight away, and ask
  // the server to kill the op tagged with this run's id. Killing nothing is not a
  // failure — the op can have finished already — so the cancel still holds locally.
  async function cancelQuery(tabId) {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab || !tab.isRunning || !tab.runId) return
    tab.cancelled = true
    tab.isRunning = false
    tab.runError = 'Query cancelled.'
    tab.runErrorCode = null
    try {
      await qapi.cancelRun(tab.connectionId, tab.runId)
      showToast('Query cancelled')
    } catch (e) {
      // The server refused to kill the op, so it is still running and its results are
      // still coming: put the tab back where it was rather than dropping them. Unless
      // the run has since settled (runId cleared) — restoring then strands a spinner
      // over a query nobody is waiting for.
      if (tab.runId) {
        tab.cancelled = false
        tab.isRunning = true
        tab.runError = null
      }
      showToast('Cancel not permitted on this server: ' + errText(e))
    }
  }

  async function runQuery(tabId, params) {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab) return
    tab.isRunning = true
    // Wall clock, and only for the live counter while the query is in flight — the
    // figure that stays behind is the server's (see below).
    tab.startedAt = Date.now()
    tab.elapsedMs = null
    tab.runError = null
    tab.runErrorCode = null
    tab.cancelled = false
    // A new run invalidates any count shown on the footer's Count Documents button,
    // so it reverts to the plain label until the user counts again.
    tab.countShown = false
    const runId = newRunId()
    tab.runId = runId
    const { addToHistory = true, ...queryParams } = params
    try {
      const res = await qapi.runFind(
        { connectionId: tab.connectionId, database: tab.dbName, collection: tab.collectionName },
        queryParams,
        runId,
      )
      if (isStale(tab, runId)) return
      // markRaw each document so Vue keeps the array reactive (row add / remove /
      // replace still update the grid) without deep-proxying every nested field of
      // every document — the result set is display-only and replaced wholesale, so
      // the per-node proxies were pure memory + CPU overhead on large results.
      tab.results = res.documents.map((doc) => markRaw(doc))
      tab.hasRun = true
      // The server's own timing, not the wall clock here — the round trip also pays
      // for IPC and rendering, which say nothing about how fast the query was.
      tab.elapsedMs = res.elapsedMs
      showToast(`Query returned ${tab.results.length} document${tab.results.length !== 1 ? 's' : ''} in ${(tab.elapsedMs / 1000).toFixed(3)}s`)
      if (addToHistory) {
        pushQueryHistory(
          { connectionId: tab.connectionId, database: tab.dbName, collection: tab.collectionName },
          {
            mode:       'find',
            filter:     tab.filter     || '',
            sort:       tab.sort       || '',
            projection: tab.projection || '',
            skip:       queryParams.skip  ?? 0,
            limit:      queryParams.limit ?? 50,
            pipeline:   '',
          },
        ).catch(() => {})
      }
    } catch (e) {
      // A killed op errors, and a stale run's error belongs to nothing on screen —
      // either way the tab already says what it needs to say.
      if (isStale(tab, runId)) return
      tab.runError = errText(e)
      tab.runErrorCode = errCode(e)
    } finally {
      // Clearing runId marks this run settled: a later response is stale, and a cancel
      // that lands now has nothing to restore.
      if (tab.runId === runId) {
        tab.isRunning = false
        tab.runId = null
      }
    }
  }

  async function runAggregate(tabId, params) {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab) return
    tab.isRunning = true
    // Wall clock, and only for the live counter while the query is in flight — the
    // figure that stays behind is the server's (see below).
    tab.startedAt = Date.now()
    tab.elapsedMs = null
    tab.runError = null
    tab.runErrorCode = null
    tab.cancelled = false
    // A new run invalidates any count shown on the footer's Count Documents button,
    // so it reverts to the plain label until the user counts again.
    tab.countShown = false
    const runId = newRunId()
    tab.runId = runId
    try {
      const res = await qapi.runAggregate(
        { connectionId: tab.connectionId, database: tab.dbName, collection: tab.collectionName },
        params.pipeline,
        runId,
      )
      if (isStale(tab, runId)) return
      tab.results = res.documents.map((doc) => markRaw(doc))
      tab.hasRun = true
      tab.elapsedMs = res.elapsedMs
      if (res.truncated) {
        showToast(`Showing the first ${res.documents.length.toLocaleString()} results — add a $limit stage to narrow it down.`)
      } else {
        showToast(`Aggregation returned ${res.documents.length} document${res.documents.length !== 1 ? 's' : ''} in ${(tab.elapsedMs / 1000).toFixed(3)}s`)
      }
      pushQueryHistory(
        { connectionId: tab.connectionId, database: tab.dbName, collection: tab.collectionName },
        {
          mode:       'aggregate',
          filter:     '',
          sort:       '',
          projection: '',
          skip:       0,
          limit:      50,
          pipeline:   tab.pipeline || '',
        },
      ).catch(() => {})
    } catch (e) {
      // A killed op errors, and a stale run's error belongs to nothing on screen —
      // either way the tab already says what it needs to say.
      if (isStale(tab, runId)) return
      tab.runError = errText(e)
      tab.runErrorCode = errCode(e)
    } finally {
      // Clearing runId marks this run settled: a later response is stale, and a cancel
      // that lands now has nothing to restore.
      if (tab.runId === runId) {
        tab.isRunning = false
        tab.runId = null
      }
    }
  }

  return {
    runQuery: runQuery,
    runAggregate: runAggregate,
    cancelQuery: cancelQuery,
  }
}
