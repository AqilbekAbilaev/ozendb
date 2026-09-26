import { getDefaultQuery } from '../engines/mongodb/api/queryLibrary'
import { parseField } from '../utils/queryParser'
import { tabs, activateTab, newTabId } from './tabs'
import { createWorkspace } from '../workspaces/createWorkspace'
import { openModal, closeModal } from './modals'
import { defaultQueryLimit, defaultResultView } from './settings'
import { runQuery } from './queryRunner'

// Every "open a tab" entry point in the app. The tab *shape* is owned by the
// workspace definitions; this is the orchestration layer — which opens focus an
// existing tab, which load and run a default query, which start in a modal, and
// which append a fresh tab. The tab state and its mutations live in tabs.js.
const newWorkspace = (type, context) => createWorkspace(type, {
  ...context,
  ids: { workspace: newTabId },
})

export async function openCollectionTab({ connectionId, connectionName, dbName, collectionName, filter }, startMode = 'find') {
  // Every open creates a new tab — the same collection may be opened in several
  // tabs (Studio-3T behavior). No dedup/focus-existing here by design.
  const type = startMode === 'aggregate' ? 'mongodb.aggregate' : 'mongodb.find'
  const tab = newWorkspace(type, {
    target: { connectionId, connectionName, dbName, collectionName },
    defaults: { queryLimit: defaultQueryLimit.value, resultView: defaultResultView.value },
  })
  const id = tab.id
  tabs.value.push(tab)
  activateTab(id)

  // Follow Reference (and any caller supplying a filter) runs that filter immediately,
  // bypassing the collection's saved default query. When the filter parses, its exact
  // text is kept on the tab so the editor, query history, and persisted session agree
  // with what ran; only the parsed EJSON goes to the query API. Text that does not
  // parse is not retained — an empty query is what runs, so an empty editor is honest.
  if (filter) {
    const pf = parseField(filter)
    if (pf.ok) tab.filter = filter
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
    def = await getDefaultQuery({ connectionId, database: dbName, collection: collectionName })
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
export function openSqlTab({ connectionId, connectionName, dbName, collectionName }) {
  const existing = tabs.value.find(t =>
    t.kind === 'collection' && t.mode === 'sql' &&
    t.connectionId === connectionId && t.dbName === dbName && t.collectionName === collectionName)
  if (existing) { activateTab(existing.id); return }
  const tab = newWorkspace('mongodb.sql_to_mql', {
    target: { connectionId, connectionName, dbName, collectionName },
    defaults: { queryLimit: defaultQueryLimit.value, resultView: defaultResultView.value },
  })
  tabs.value.push(tab)
  activateTab(tab.id)
}

// Open an IntelliShell tab scoped to a connection + database. Each shell tab has
// its own backend JS session (sessionId), so variables persist across runs.
export function openShellTab({ connectionId, connectionName, dbName }) {
  const tab = newWorkspace('mongodb.shell', {
    target: { connectionId, connectionName, dbName },
  })
  tabs.value.push(tab)
  activateTab(tab.id)
}

// Opens (or re-focuses) an Index Manager tab for a collection. The tab is a thin
// shell around the shared useIndexes state; IndexManagerPane loads it on mount.
export function openIndexManagerTab({ connId, connName, dbName, collName }) {
  const existing = tabs.value.find(t =>
    t.kind === 'indexes' && t.connectionId === connId && t.dbName === dbName && t.collectionName === collName)
  if (existing) { activateTab(existing.id); return }
  const tab = newWorkspace('mongodb.indexes', { target: { connId, connName, dbName, collName } })
  tabs.value.push(tab)
  activateTab(tab.id)
}

// Open (or focus) a collection-scoped tool tab — Studio-3T renders Schema,
// etc. as workspace tabs rather than modals. Reopening the same tool on the same
// collection focuses the existing tab.
export function openSchemaTab({ connId, connName, dbName, collName }) {
  const existing = tabs.value.find(t =>
    t.kind === 'schema' && t.connectionId === connId && t.dbName === dbName && t.collectionName === collName)
  if (existing) { activateTab(existing.id); return }
  const tab = newWorkspace('mongodb.schema', { target: { connId, connName, dbName, collName } })
  tabs.value.push(tab)
  activateTab(tab.id)
}

// Export starts with the source picker (Entire Collection / Current Query Result /
// Selected Documents). The two narrower sources are only offered when an open
// collection tab for the same collection can supply them, so the query and the
// selected _ids are resolved here and handed to the modal.
export function openExportSource(node) {
  const tab = tabs.value.find(t =>
    t.kind === 'collection' && t.connectionId === node.connId
    && t.dbName === node.dbName && t.collectionName === node.collName)
  const pf = tab ? parseField(tab.filter) : null
  const rows = (tab && tab.selectedRows) || []
  const selectedIds = rows
    .map(i => tab.results[i])
    .filter(doc => doc && doc._id !== undefined)
    .map(doc => doc._id)
  const target = {
    ...node,
    // The modal reads the long spelling; openExportTab still builds a tool
    // workspace from the short one, so this object carries both until the node
    // path is migrated too (audit §8).
    connectionId: node.connId,
    connectionName: node.connName,
    collectionName: node.collName,
    query: pf && pf.ok ? pf.ejson : null,
    selectedIds: selectedIds,
  }
  openModal('exportSource', target, {
    on: {
      choose: (source) => {
        openExportTab(target, source)
        closeModal('exportSource')
      },
    },
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
export function openExportTab(target, source) {
  const tab = newWorkspace('mongodb.export', {
    target: target,            // { connId, connName, dbName, collName, query, selectedIds }
    options: { source: source || 'collection', format: 'json' },
  })
  tabs.value.push(tab)
  activateTab(tab.id)
}

// Search is database-scoped (it scans every collection in one db).
export function openSearchTab({ connId, connName, dbName }) {
  const existing = tabs.value.find(t => t.kind === 'search' && t.connectionId === connId && t.dbName === dbName)
  if (existing) { activateTab(existing.id); return }
  const tab = newWorkspace('mongodb.search', { target: { connId, connName, dbName } })
  tabs.value.push(tab)
  activateTab(tab.id)
}

// Current Operations is connection-scoped, and every open makes its own tab (as opening
// a collection does): two views of the same server can watch it through different
// filters — one on a namespace, one on slow ops only — and silently focusing an
// existing tab would take one of those away.
export function openCurrentOpsTab({ connId, connName }) {
  const tab = newWorkspace('mongodb.current_operations', { target: { connId, connName } })
  tabs.value.push(tab)
  activateTab(tab.id)
}

// Opens an Import tab for a collection with the format chosen in the picker. The
// pane (ImportPane) mutates the working state (sources, validate, preview) directly
// on the tab, so it survives tab switches; the persisted subset (format, validate,
// sources) lets the tab return on restart. Each source targets a db.collection on
// this connection; Run loops over the sources on the frontend.
export function openImportTab({ connId, connName, dbName, collName }, format) {
  const tab = newWorkspace('mongodb.import', {
    target: { connId, connName, dbName, collName },
    options: { format: format },
  })
  tabs.value.push(tab)
  activateTab(tab.id)
}

// Help → Quickstart: focus the existing Quickstart tab, or open one if it was closed.
export function openQuickstart() {
  const existing = tabs.value.find(t => t.kind === 'quickstart')
  if (existing) {
    activateTab(existing.id)
    return
  }
  const tab = newWorkspace('app.quickstart', {})
  tabs.value.push(tab)
  activateTab(tab.id)
}

// A PostgreSQL table, like a MongoDB collection, opens a new tab every time.
export function openPostgresTable({ connectionId, connectionName, database, schema, table }) {
  const tab = newWorkspace('postgresql.table_browse', {
    target: { connectionId, connectionName, database, schema, table },
  })
  tabs.value.push(tab)
  activateTab(tab.id)
}

// A SQL editor against a PostgreSQL connection's database; a new tab every time.
export function openPostgresQuery({ connectionId, connectionName, database }) {
  const tab = newWorkspace('postgresql.query', { target: { connectionId, connectionName, database } })
  tabs.value.push(tab)
  activateTab(tab.id)
}
