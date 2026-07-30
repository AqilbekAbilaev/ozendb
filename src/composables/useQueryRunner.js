import { markRaw } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { errText, errCode } from '../utils/errors'
import { parseField } from '../utils/queryParser'
import { tabs } from '../stores/tabs'

// Query execution: running find/aggregate queries against a tab, cancelling an
// in-flight query, and re-running a tab restored from a previous session.
// Tabs come from the store, so this mutates the same tab objects every other consumer
// sees; `showToast` is still injected to surface the same toasts as before.
export function useQueryRunner({ showToast }) {
  // ── query execution ────────────────────────────────────────
  // A unique tag stamped on each query op (as its `comment`) so a cancel can find
  // and kill exactly that operation server-side.
  function newRunId() {
    return 'q' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)
  }

  // Best-effort cancel of a tab's in-flight query: ask the server to kill the op
  // tagged with this run's id. The awaited find/aggregate then rejects, which the
  // run handlers render as a calm "cancelled" state (because tab.cancelled is set).
  async function cancelQuery(tabId) {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab || !tab.isRunning || !tab.runId) return
    tab.cancelled = true
    try {
      const killed = await invoke('kill_query', { id: tab.connectionId, comment: tab.runId })
      showToast(killed > 0 ? 'Query cancelled' : 'Query already finished')
    } catch (e) {
      tab.cancelled = false
      showToast('Cancel not permitted on this server: ' + errText(e))
    }
  }

  async function runQuery(tabId, params) {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab) return
    tab.isRunning = true
    tab.runError = null
    tab.runErrorCode = null
    tab.cancelled = false
    // A new run invalidates any count shown on the footer's Count Documents button,
    // so it reverts to the plain label until the user counts again.
    tab.countShown = false
    const runId = newRunId()
    tab.runId = runId
    const t0 = Date.now()
    const { addToHistory = true, ...queryParams } = params
    try {
      const docs = await invoke('find_documents', {
        id:         tab.connectionId,
        database:   tab.dbName,
        collection: tab.collectionName,
        ...queryParams,
        comment:    runId,
      })
      // markRaw each document so Vue keeps the array reactive (row add / remove /
      // replace still update the grid) without deep-proxying every nested field of
      // every document — the result set is display-only and replaced wholesale, so
      // the per-node proxies were pure memory + CPU overhead on large results.
      tab.results = docs.map((doc) => markRaw(doc))
      tab.hasRun = true
      tab.elapsedMs = Date.now() - t0
      showToast(`Query returned ${tab.results.length} document${tab.results.length !== 1 ? 's' : ''} in ${(tab.elapsedMs / 1000).toFixed(3)}s`)
      if (addToHistory) {
        invoke('push_query_history', {
          connectionId: tab.connectionId,
          database:     tab.dbName,
          collection:   tab.collectionName,
          mode:         'find',
          filter:       tab.filter     || '',
          sort:         tab.sort       || '',
          projection:   tab.projection || '',
          skip:         queryParams.skip  ?? 0,
          limit:        queryParams.limit ?? 50,
          pipeline:     '',
        }).catch(() => {})
      }
    } catch (e) {
      // A deliberate cancel makes the killed op error — show a calm state, not a scary one.
      if (tab.cancelled) {
        tab.runError = 'Query cancelled.'
        tab.runErrorCode = null
      } else {
        tab.runError = errText(e)
        tab.runErrorCode = errCode(e)
      }
    } finally {
      tab.isRunning = false
    }
  }

  async function runAggregate(tabId, params) {
    const tab = tabs.value.find(t => t.id === tabId)
    if (!tab) return
    tab.isRunning = true
    tab.runError = null
    tab.runErrorCode = null
    tab.cancelled = false
    // A new run invalidates any count shown on the footer's Count Documents button,
    // so it reverts to the plain label until the user counts again.
    tab.countShown = false
    const runId = newRunId()
    tab.runId = runId
    const t0 = Date.now()
    try {
      const res = await invoke('run_aggregate', {
        id:         tab.connectionId,
        database:   tab.dbName,
        collection: tab.collectionName,
        ...params,
        comment:    runId,
      })
      tab.results = res.documents.map((doc) => markRaw(doc))
      tab.hasRun = true
      tab.elapsedMs = Date.now() - t0
      if (res.truncated) {
        showToast(`Showing the first ${res.documents.length.toLocaleString()} results — add a $limit stage to narrow it down.`)
      } else {
        showToast(`Aggregation returned ${res.documents.length} document${res.documents.length !== 1 ? 's' : ''} in ${(tab.elapsedMs / 1000).toFixed(3)}s`)
      }
      invoke('push_query_history', {
        connectionId: tab.connectionId,
        database:     tab.dbName,
        collection:   tab.collectionName,
        mode:         'aggregate',
        filter:       '',
        sort:         '',
        projection:   '',
        skip:         0,
        limit:        50,
        pipeline:     tab.pipeline || '',
      }).catch(() => {})
    } catch (e) {
      if (tab.cancelled) {
        tab.runError = 'Query cancelled.'
        tab.runErrorCode = null
      } else {
        tab.runError = errText(e)
        tab.runErrorCode = errCode(e)
      }
    } finally {
      tab.isRunning = false
    }
  }

  // A tab restored from a previous session carries its query text but no results.
  // We run it lazily — the first time it becomes active — so a restart doesn't
  // reconnect to every server at once. Find tabs re-run their stored query;
  // aggregate tabs just keep their pipeline text and wait for a manual run.
  function runRestoredTab(tab) {
    tab._restored = false
    if (tab.mode !== 'find') return
    const pf = parseField(tab.filter     || '')
    const ps = parseField(tab.sort       || '')
    const pp = parseField(tab.projection || '')
    runQuery(tab.id, {
      filter:     pf.ok ? pf.ejson : '{}',
      sort:       ps.ok ? ps.ejson : '{}',
      projection: pp.ok ? pp.ejson : '{}',
      skip:       Number(tab.skip),
      limit:      Number(tab.limit),
    })
  }

  return {
    runQuery: runQuery,
    runAggregate: runAggregate,
    cancelQuery: cancelQuery,
    runRestoredTab: runRestoredTab,
  }
}
