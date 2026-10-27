import { getDefaultQuery } from './api/queryLibrary'
import { apiTarget } from './api/payload'
import { parseField } from './query/queryParser'
import { sameResource } from '../../utils/resourceRef'
import { tabs, activeTab } from '../../stores/tabs'
import { openWorkspaceTab, newWorkspaceTab, showWorkspaceTab, focusOrOpenWorkspaceTab } from '../../stores/tabCreators'
import { openModal, closeModal } from '../../stores/modals'
import { defaultQueryLimit, defaultResultView } from '../../stores/settings'
import { runQuery } from './workspaces/collection/queryRunner'
import { workspaceIsCollection } from '../../workspaces/registry'

// MongoDB's "open a tab" entry points, built on the shared helpers in stores/tabCreators.js.

// The query openers take `{ resource, connectionName }`, as the tool openers do (#193).
export async function openCollectionTab({ resource, connectionName, filter }, startMode = 'find') {
  // Every open creates a new tab — the same collection may be opened in several
  // tabs (Studio-3T behavior). No dedup/focus-existing here by design.
  const type = startMode === 'aggregate' ? 'mongodb.aggregate' : 'mongodb.find'
  const tab = newWorkspaceTab(type, {
    target: { resource, connectionName },
    defaults: { queryLimit: defaultQueryLimit.value, resultView: defaultResultView.value },
  })
  const id = tab.id
  showWorkspaceTab(tab)

  // Follow Reference (and any caller supplying a filter) runs that filter immediately,
  // bypassing the collection's saved default query. When the filter parses, its exact
  // text is kept on the tab so the editor, query history, and persisted session agree
  // with what ran; only the parsed EJSON goes to the query API. Text that does not
  // parse is not retained — an empty query is what runs, so an empty editor is honest.
  if (filter) {
    const pf = parseField(filter)
    if (pf.ok) tab.state.query.filter = filter
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
    def = await getDefaultQuery(apiTarget(resource))
  } catch (_) {}

  // Aggregation tabs open with an empty pipeline; nothing to run until the user writes one.
  if (startMode !== 'find') return

  if (def) {
    const tab = tabs.value.find(t => t.id === id)
    if (tab) {
      tab.state.query.filter     = def.filter     || ''
      tab.state.query.sort       = def.sort       || ''
      tab.state.query.projection = def.projection || ''
      tab.state.query.skip       = Number(def.skip)
      tab.state.query.limit      = Number(def.limit)
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
export function openSqlTab({ resource, connectionName }) {
  focusOrOpenWorkspaceTab('mongodb.sql_to_mql', resource, {
    target: { resource, connectionName },
    defaults: { queryLimit: defaultQueryLimit.value, resultView: defaultResultView.value },
  })
}

// Open an IntelliShell tab scoped to a connection + database. Each shell tab has
// its own backend JS session (sessionId), so variables persist across runs.
export function openShellTab({ resource, connectionName }) {
  openWorkspaceTab('mongodb.shell', { target: { resource, connectionName } })
}

// Opens (or re-focuses) an Index Manager tab for a collection. The tab is a thin
// shell around the shared useIndexes state; IndexManagerPane loads it on mount.
export function openIndexManagerTab({ resource, connectionName }) {
  focusOrOpenWorkspaceTab('mongodb.indexes', resource, { target: { resource, connectionName } })
}

// Open (or focus) a collection-scoped tool tab — Studio-3T renders Schema,
// etc. as workspace tabs rather than modals. Reopening the same tool on the same
// collection focuses the existing tab.
export function openSchemaTab({ resource, connectionName }) {
  focusOrOpenWorkspaceTab('mongodb.schema', resource, { target: { resource, connectionName } })
}

// Export starts with the source picker (Entire Collection / Current Query Result /
// Selected Documents). The two narrower sources are only offered when an open
// collection tab for the same collection can supply them, so the query and the
// selected _ids are resolved here and handed to the modal. The active tab wins when it
// shows the collection, since the same collection may be open in several tabs (#275).
export function openExportSource({ resource, connectionName }) {
  const showsNode = t => workspaceIsCollection(t) && sameResource(t.target, resource)
  const tab = activeTab.value && showsNode(activeTab.value) ? activeTab.value : tabs.value.find(showsNode)
  const pf = tab ? parseField(tab.state.query.filter) : null
  const rows = (tab && tab.runtime.selectedRows) || []
  const selectedIds = rows
    .map(i => tab.runtime.results[i])
    .filter(doc => doc && doc._id !== undefined)
    .map(doc => doc._id)
  // The picker and the export tab share one payload: the collection's reference plus
  // the two narrower sources this collection's open tab can supply.
  const target = {
    resource: resource,
    connectionName: connectionName,
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
  openWorkspaceTab('mongodb.export', {
    target: target,            // { resource, connectionName, query, selectedIds }
    options: { source: source || 'collection', format: 'json' },
  })
}

// Search is database-scoped (it scans every collection in one db).
export function openSearchTab({ resource, connectionName }) {
  focusOrOpenWorkspaceTab('mongodb.search', resource, { target: { resource, connectionName } })
}

// Current Operations is connection-scoped, and every open makes its own tab (as opening
// a collection does): two views of the same server can watch it through different
// filters — one on a namespace, one on slow ops only — and silently focusing an
// existing tab would take one of those away.
export function openCurrentOpsTab({ resource, connectionName }) {
  openWorkspaceTab('mongodb.current_operations', { target: { resource, connectionName } })
}

// Opens an Import tab for a collection with the format chosen in the picker. The
// pane (ImportPane) mutates the working state (sources, validate, preview) directly
// on the tab, so it survives tab switches; the persisted subset (format, validate,
// sources) lets the tab return on restart. Each source targets a db.collection on
// this connection; Run loops over the sources on the frontend.
export function openImportTab({ resource, connectionName }, format) {
  openWorkspaceTab('mongodb.import', {
    target: { resource, connectionName },
    options: { format: format },
  })
}
