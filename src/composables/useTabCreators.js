import { nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { parseField } from '../utils/queryParser'
import { tabs, activeTabId, activateTab, newTabId } from '../stores/tabs'
import { opsDefaults } from './useCurrentOps'

// Every "open a tab" entry point in the app. The tab *state* and its mutations live in
// stores/tabs.js; these are the constructors that decide what a newly opened tab of each
// kind contains. They were the last ~260 lines of tab logic still sitting in App.vue.
//
// Takes the handful of App.vue bindings they genuinely need rather than reading a global:
// the two settings-backed defaults a new tab adopts, the query runner (opening a collection
// runs its first query), the modal API (export and import both start in a modal), and the
// toast for the one reachable failure.
export function useTabCreators({
  defaultQueryLimit,
  defaultResultView,
  runQuery,
  modalsApi,
  showToast,
}) {
  async function openCollectionTab({ connectionId, connectionName, dbName, collectionName, filter }, startMode = 'find') {
    // Every open creates a new tab — the same collection may be opened in several
    // tabs (Studio-3T behavior). No dedup/focus-existing here by design.
    const id = newTabId()
    tabs.value.push({
      id: id, kind: 'collection',
      title: collectionName,
      connectionId: connectionId,
      connectionName: connectionName,
      dbName: dbName,
      collectionName: collectionName,
      filter: filter || '', projection: '', sort: '', skip: 0, limit: defaultQueryLimit.value,
      mode: startMode, pipeline: '',
      vqb: null,
      resultView: defaultResultView.value,
      results: [], hasRun: false, isRunning: false, runError: null,
      selectedRow: -1, selectedRows: [], elapsedMs: null,
    })
    activeTabId.value = id

    // Follow Reference (and any caller supplying a filter) runs that filter immediately,
    // bypassing the collection's saved default query.
    if (filter) {
      const pf = parseField(filter)
      runQuery(id, {
        filter:     pf.ok ? pf.ejson : '{}',
        projection: '{}',
        sort:       '{}',
        skip:       0,
        limit:      defaultQueryLimit.value,
      })
      return
    }

    let def = null
    try {
      def = await invoke('get_default_query', {
        connectionId: connectionId,
        database:     dbName,
        collection:   collectionName,
      })
    } catch (_) {}

    // Aggregation tabs open with an empty pipeline; nothing to run until the user writes one.
    if (startMode !== 'find') return

    if (def) {
      const tab = tabs.value.find(t => t.id === id)
      if (tab) {
        tab.filter     = def.filter     || ''
        tab.sort       = def.sort       || ''
        tab.projection = def.projection || ''
        tab.skip       = Number(def.skip)
        tab.limit      = Number(def.limit)
      }
      const pf = parseField(def.filter     || '')
      const ps = parseField(def.sort       || '')
      const pp = parseField(def.projection || '')
      runQuery(id, {
        filter:     pf.ok ? pf.ejson : '{}',
        sort:       ps.ok ? ps.ejson : '{}',
        projection: pp.ok ? pp.ejson : '{}',
        skip:       Number(def.skip),
        limit:      Number(def.limit),
      })
    } else {
      runQuery(id, { filter: '{}', projection: '{}', sort: '{}', skip: 0, limit: defaultQueryLimit.value })
    }
  }

  // Opens (or re-focuses) a SQL query tab for a collection. It's a collection tab in
  // `sql` mode: the query area shows a SQL editor, but the whole result stack (grid,
  // paging, Query Code, Explain) is reused. One SQL tab per collection.
  function openSqlTab({ connectionId, connectionName, dbName, collectionName }) {
    const existing = tabs.value.find(t =>
      t.kind === 'collection' && t.mode === 'sql' &&
      t.connectionId === connectionId && t.dbName === dbName && t.collectionName === collectionName)
    if (existing) { activeTabId.value = existing.id; return }
    const id = newTabId()
    tabs.value.push({
      id: id, kind: 'collection',
      title: 'SQL: ' + collectionName,
      connectionId: connectionId,
      connectionName: connectionName,
      dbName: dbName,
      collectionName: collectionName,
      filter: '', projection: '', sort: '', skip: 0, limit: defaultQueryLimit.value,
      mode: 'sql', pipeline: '',
      sql: 'SELECT *\nFROM ' + collectionName,
      sqlError: null,
      vqb: null,
      results: [], hasRun: false, isRunning: false, runError: null,
      selectedRow: -1, selectedRows: [], elapsedMs: null,
    })
    activeTabId.value = id
  }

  // Open an IntelliShell tab scoped to a connection + database. Each shell tab has
  // its own backend JS session (sessionId), so variables persist across runs.
  function openShellTab({ connectionId, connectionName, dbName }) {
    const id = newTabId()
    tabs.value.push({
      id: id, kind: 'shell',
      title: 'mongosh: ' + dbName,
      connectionId: connectionId,
      connectionName: connectionName,
      dbName: dbName,
      sessionId: (crypto.randomUUID ? crypto.randomUUID() : id),
      // editor + command history (dropdown)
      code: '', history: [], isRunning: false,
      // result state, read by the reused result grid (ResultTable / TreeView)
      results: [], resultView: 'table', resultTab: 'Console',
      runError: null, elapsedMs: null, drillPath: [], hasRun: false, selectedRow: -1, selectedRows: [],
      logs: [], scalar: undefined, hasScalar: false,
    })
    activeTabId.value = id
  }

  // Opens (or re-focuses) an Index Manager tab for a collection. The tab is a thin
  // shell around the shared useIndexes state; IndexManagerPane loads it on mount.
  function openIndexManagerTab({ connId, connName, dbName, collName }) {
    const existing = tabs.value.find(t =>
      t.kind === 'indexes' && t.connId === connId && t.dbName === dbName && t.collName === collName)
    if (existing) { activeTabId.value = existing.id; return }
    const id = newTabId()
    tabs.value.push({
      id: id, kind: 'indexes',
      title: 'Index Manager: ' + collName,
      connId: connId, connName: connName, dbName: dbName, collName: collName,
    })
    activeTabId.value = id
  }

  // Open (or focus) a collection-scoped tool tab — Studio-3T renders Schema,
  // etc. as workspace tabs rather than modals. Reopening the same tool on the same
  // collection focuses the existing tab.
  function openCollectionToolTab(kind, titlePrefix, { connId, connName, dbName, collName }) {
    const existing = tabs.value.find(t =>
      t.kind === kind && t.connId === connId && t.dbName === dbName && t.collName === collName)
    if (existing) { activeTabId.value = existing.id; return }
    const id = newTabId()
    tabs.value.push({
      id: id, kind: kind, title: titlePrefix + ': ' + collName,
      connId: connId, connName: connName, dbName: dbName, collName: collName,
    })
    activeTabId.value = id
  }
  function openSchemaTab(node)   { openCollectionToolTab('schema', 'Schema', node) }

  // Export starts with the source picker (Entire Collection / Current Query Result /
  // Selected Documents). The two narrower sources are only offered when an open
  // collection tab for the same collection can supply them, so the query and the
  // selected _ids are resolved here and handed to the modal.
  function openExportSource(node) {
    const tab = tabs.value.find(t =>
      t.kind === 'collection' && t.connectionId === node.connId
      && t.dbName === node.dbName && t.collectionName === node.collName)
    const pf = tab ? parseField(tab.filter) : null
    const rows = (tab && tab.selectedRows) || []
    const selectedIds = rows
      .map(i => tab.results[i])
      .filter(doc => doc && doc._id !== undefined)
      .map(doc => doc._id)
    modalsApi.openModal('exportSource', {
      ...node,
      query: pf && pf.ok ? pf.ejson : null,
      selectedIds: selectedIds,
    })
  }

  // Opens (or focuses) an Export tab for a collection. The wizard's working state lives
  // on the tab — the pane is unmounted on a tab switch, so local refs would reset the
  // step and field mapping every time. `result` holds the last successful run so the tab
  // can show it and offer a re-run; it is deliberately not persisted across restarts.
  //
  // `source` comes from the picker and fixes what gets exported: the whole collection, the
  // originating tab's query, or an explicit _id set. The resulting filter is frozen onto
  // the tab at open time — re-running the export re-reads the collection, but through the
  // query as it was when the export was set up, not whatever the other tab shows now.
  function openExportTab(target, source) {
    const { connId, connName, dbName, collName } = target
    const filter = source === 'query'
      ? (target.query || '{}')
      : source === 'selected'
        ? JSON.stringify({ _id: { $in: target.selectedIds || [] } })
        : '{}'
    // Each Export opens its own tab rather than focusing an existing one: two exports of
    // the same collection can have different sources, and silently reusing a tab would
    // change what the user set up. The title carries the source so they stay tellable
    // apart in the tab bar.
    const suffix = source === 'query' ? ' (query)'
      : source === 'selected' ? ` (${(target.selectedIds || []).length} selected)`
      : ''
    const id = newTabId()
    tabs.value.push({
      id: id, kind: 'export', title: 'Export: ' + collName + suffix,
      connId: connId, connName: connName, dbName: dbName, collName: collName,
      step: 0, format: 'json', incremental: false,
      source: source || 'collection',
      sourceCount: source === 'selected' ? (target.selectedIds || []).length : null,
      filter: filter,
      fields: [],          // [{ source, target, kind, include }] — the user's mapping
      result: null,        // { count, path } after a successful export
    })
    activeTabId.value = id
  }


  // Search is database-scoped (it scans every collection in one db).
  function openSearchTab({ connId, connName, dbName }) {
    const existing = tabs.value.find(t => t.kind === 'search' && t.connId === connId && t.dbName === dbName)
    if (existing) { activeTabId.value = existing.id; return }
    const id = newTabId()
    tabs.value.push({
      id: id, kind: 'search', title: 'Search: ' + dbName,
      connId: connId, connName: connName, dbName: dbName,
    })
    activeTabId.value = id
  }

  // Current Operations is connection-scoped: one live view per server, so reopening it
  // focuses the tab already watching that connection.
  function openCurrentOpsTab({ connId, connName }) {
    const existing = tabs.value.find(t => t.kind === 'currentOps' && t.connId === connId)
    if (existing) { activeTabId.value = existing.id; return }
    const id = newTabId()
    tabs.value.push({
      id: id, kind: 'currentOps', title: 'Current Operations: ' + connName,
      connId: connId, connName: connName,
      // The toolbar settings and the grid's own state live on the tab so they survive a
      // tab switch (the pane is unmounted while another tab is active).
      ...opsDefaults(),
    })
    activeTabId.value = id
  }

  // Opens an Import tab for a collection with the format chosen in the picker. The
  // pane (ImportPane) mutates the working state (sources, validate, preview) directly
  // on the tab, so it survives tab switches; the persisted subset (format, validate,
  // sources) lets the tab return on restart. Each source targets a db.collection on
  // this connection; Run loops over the sources on the frontend.
  function openImportTab({ connId, connName, dbName, collName }, format) {
    const id = newTabId()
    const base = {
      id: id, kind: 'import',
      title: 'Import: ' + collName,
      connId: connId, connName: connName, dbName: dbName, collName: collName,
      format: format,
    }
    if (format === 'csv') {
      // CSV is single-source with Source/Target sub-tabs and per-file CSV options.
      tabs.value.push({
        ...base,
        subTab: 'source',           // 'source' | 'target'
        sourceType: 'file',         // 'clipboard' | 'file'
        filePath: '',
        csv: { delimiter: ',', other: '', qualifier: '"', skipLines: 0, hasHeader: true },
        targetDb: dbName, targetColl: collName, mode: 'insert',
        fields: [],                 // column → field mapping (Target options)
      })
    } else {
      // JSON is a multi-source table.
      tabs.value.push({
        ...base,
        validate: false,
        sources: [],                // { path, name, targetDb, targetColl, mode }
        selectedSource: -1,
        previewOpen: false,
      })
    }
    activeTabId.value = id
  }

  // GridFS menu actions operate inside the GridFS modal on its selected file/bucket.
  // Ensure the modal is open for the resolved database (preserving any existing

  // Help → Quickstart: focus the existing Quickstart tab, or open one if it was closed.
  function openQuickstart() {
    const existing = tabs.value.find(t => t.kind === 'quickstart')
    if (existing) {
      activateTab(existing.id)
      return
    }
    const id = newTabId()
    tabs.value.push({ id: id, kind: 'quickstart', title: 'Quickstart' })
    activateTab(id)
  }

  return {
    openCollectionTab,
    openSqlTab,
    openShellTab,
    openIndexManagerTab,
    openSchemaTab,
    openExportSource,
    openExportTab,
    openSearchTab,
    openCurrentOpsTab,
    openImportTab,
    openQuickstart,
  }
}
