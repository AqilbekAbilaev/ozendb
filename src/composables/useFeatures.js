import { disconnect } from '../engines/mongodb/api/connections'
import { showToast } from '../stores/toast'
import {
  openCollectionTab, openShellTab, openIndexManagerTab, openSqlTab, openSchemaTab,
  openSearchTab, openCurrentOpsTab, openExportSource,
} from '../stores/tabCreators'
import { useDbActions } from './useDbActions'
import { useNodeTags } from './useNodeTags'
import { useDbTransfer } from './useDbTransfer'
import { dbClipboard } from '../stores/dbClipboard'
import { treeSelection, setTreeSelection } from '../stores/connectionNavigation'
import { contextMenu } from '../stores/contextMenu'
import { TOOLS } from '../constants/tools'
import { MODALS } from '../constants/modalRegistry'
import { activeTab, closeWhere, handleTabAction } from '../stores/tabs'
import { affectedByResource } from '../workspaces/lifecycle'
import { createResourceRef } from '../utils/resourceRef'
import { resourceFromLegacyTab, legacyTargetFromResource } from '../utils/legacyResourceRef'
import { errText } from '../utils/errors'
import { refreshConnectionResources } from '../stores/connectionData'
import { openConnections, closeConnection } from '../stores/openConnections'
import { openModal } from '../stores/modals'

// Node-action dispatch layer, shared by the right-click menu (@pick →
// handleContextAction), the native menu bar (handleMenuAction → menuNode →
// handleContextAction) and the toolbar (@tool → handleTool). Every action is
// described once in FEATURES: the node level it needs and what it does. A "node"
// here is the normalized shape { connId, connName, dbName, collName }.
//
// Dependencies are injected so this stays UI-agnostic and testable: `dbActions` is the
// sibling composable API; the rest are shared refs and the tab creators, which remain in
// App.vue. Tab state comes from the store; modals open through stores/modals.js directly.
// Context-menu entries that are deliberately offered but not implemented yet. Naming
// them is what lets an *unrecognised* action be treated as the bug it is: while
// "absent from FEATURES" meant "coming soon", a renamed or mistyped label was
// indistinguishable from a placeholder and quietly lied to the user.
export const UNBUILT_ACTIONS = new Set([
  'Duplicate Database…',
  'Export URI…',
])

// `menuTarget` comes from useMenu, which App.vue constructs once because it also
// owns the watcher that pushes the menu context to the native menu.
export function useFeatures({ menuTarget }) {
  const { pasteClipboard } = useDbActions()
  const { applyColorTag } = useNodeTags()
  const { openImportWizard, exportDatabase, importDatabase } = useDbTransfer()

  const CONN = ['connId', 'connName']
  const DB   = ['connId', 'connName', 'dbName']
  const COLL = ['connId', 'connName', 'dbName', 'collName']

  // Toolbar tool name → registry action. Tools whose behavior is app-level
  // (connect/sql) or bespoke (collection/shell) are handled in handleTool.
  const TOOL_ALIASES = {
    aggregate: 'Open Aggregation Editor',
    export:    'Export…',
    import:    'Import…',
    schema:    'View Schema',
    search:    'Search in…',
  }

  function pick(node, fields) {
    const out = {}
    for (const field of fields) out[field] = node[field]
    return out
  }

  // Add View is the one structural dialog whose payload isn't just the node's level fields:
  // it carries the source collection to prefill (empty from a database node, the clicked
  // collection from "Add View Here…"), so it opens directly instead of via modalFeature.
  function openAddView(node, source) {
    openModal('addView', { ...modalTarget(node, 'database'), source: source })
  }

  // A registry-driven modal feature (see constants/modalRegistry.js): its level and
  // component are declared once in MODALS, so the feature is named by id alone and opens
  // the registry modal with the node fields that level needs.
  const LEVEL_FIELDS = { connection: CONN, database: DB, collection: COLL }

  // A modal's target. Modals read the long alias spelling — the same one the tab
  // creators, the Mongo API and the menu target resolution use — so the short
  // connId/collName pair stops here and never reaches a component. The FEATURES nodes
  // upstream are still short; converting those is the rest of audit §8.
  function modalTarget(node, level) {
    const short = pick(node, LEVEL_FIELDS[level])
    return {
      connectionId: short.connId,
      connectionName: short.connName,
      ...(short.dbName !== undefined ? { dbName: short.dbName } : {}),
      ...(short.collName !== undefined ? { collectionName: short.collName } : {}),
    }
  }

  function modalFeature(id) {
    const level = MODALS[id].level
    return { requires: level, run: (node) => openModal(id, modalTarget(node, level)) }
  }

  // A workspace's identity in the long alias spelling, read through its ResourceRef so
  // the short-alias tool workspaces resolve the same as collection ones, and so a
  // Current Operations tab's dbName/collName filters are not mistaken for its scope.
  function workspaceTarget(workspace) {
    if (!workspace) return null
    return legacyTargetFromResource(
      resourceFromLegacyTab(workspace),
      workspace.connectionName ?? workspace.connName ?? null,
    )
  }

  // Normalize a tab (connectionId/collectionName keys) into a registry node.
  function tabNode(tab) {
    if (!tab) return {}
    return { connId: tab.connectionId, connName: tab.connectionName, dbName: tab.dbName, collName: tab.collectionName }
  }
  function tabArgs(node) {
    return { connectionId: node.connId, connectionName: node.connName, dbName: node.dbName, collectionName: node.collName }
  }
  function shellArgs(node) {
    return { connectionId: node.connId, connectionName: node.connName, dbName: node.dbName }
  }

  async function disconnectOne(node, ctx) {
    try { await disconnect(node.connId) } catch (_) {}
    await closeConnection(node.connId)
    // Every tab scoped into this connection is stale once it's gone — including tool
    // tabs, whose short alias keys the old filter could never see. Containment runs
    // disposal (shell teardown) through closeTab for each affected workspace.
    closeWhere(affectedByResource(createResourceRef(node.connId)))
    showToast('Disconnected from ' + ctx.label)
  }
  async function disconnectOthers(node) {
    // Snapshot first: closing mutates the list the loop is reading.
    const others = openConnections.value.filter(c => c.id !== node.connId)
    for (const conn of others) {
      try { await disconnect(conn.id) } catch (_) {}
      await closeConnection(conn.id)
    }
    // Keep every tab scoped under the surviving connection; close all other
    // resource-scoped tabs. The old filter closed every non-collection tab — it
    // killed shells that were still valid and kept stale ones on dropped connections.
    const keep = affectedByResource(createResourceRef(node.connId))
    closeWhere(t => !!t.target && !keep(t))
    showToast('Disconnected all other connections')
  }
  async function disconnectAll() {
    for (const conn of [...openConnections.value]) {
      try { await disconnect(conn.id) } catch (_) {}
      await closeConnection(conn.id)
    }
    // Every resource-scoped tab belongs to a now-disconnected connection; only
    // resource-less workspaces (Quickstart) survive.
    closeWhere(t => !!t.target)
    showToast('All connections closed')
  }
  async function refreshSelected(node) {
    try {
      await refreshConnectionResources(node.connId)
      showToast('Refreshed')
    } catch (e) {
      showToast('Refresh failed: ' + errText(e))
    }
  }
  async function refreshAll() {
    let done = 0
    let failed = 0
    for (const conn of openConnections.value) {
      try {
        await refreshConnectionResources(conn.id)
        done++
      } catch {
        failed++
      }
    }
    showToast(failed ? `Refreshed ${done} connection${done === 1 ? '' : 's'}, ${failed} failed` : 'All connections refreshed')
  }

  function openServerInfo(node, kind, title) {
    openModal('serverInfo', {
      ...modalTarget(node, 'connection'), kind: kind, title: title,
    })
  }
  function copyToClipboard(node, kind) {
    if (kind === 'collection') {
      dbClipboard.value = { kind: 'collection', connId: node.connId, connName: node.connName, dbName: node.dbName, collName: node.collName }
      showToast(`Copied collection "${node.collName}"`)
    } else {
      dbClipboard.value = { kind: 'database', connId: node.connId, connName: node.connName, dbName: node.dbName }
      showToast(`Copied database "${node.dbName}"`)
    }
  }

  const FEATURES = {
    // ── open a tab ──
    'Open Collection':         { requires: 'collection', run: (n) => openCollectionTab(tabArgs(n)) },
    'Open Aggregation Editor': { requires: 'collection', run: (n) => openCollectionTab(tabArgs(n), 'aggregate') },
    'Open IntelliShell':       { requires: 'database',   run: (n) => openShellTab(shellArgs(n)) },
    'Indexes…':                { requires: 'collection', run: (n) => openIndexManagerTab(pick(n, COLL)) },

    // ── connection-scoped info modals ──
    'Server Status':           modalFeature('serverStatus'),
    'Server Status Charts':    modalFeature('serverCharts'),
    'Current Operations':      { requires: 'connection', run: (n) => openCurrentOpsTab(pick(n, CONN)) },
    'Build Info':              { requires: 'connection', run: (n) => openServerInfo(n, 'build',   'Build Info') },
    'Host Info':               { requires: 'connection', run: (n) => openServerInfo(n, 'host',    'Host Info') },
    'Replica Set Status':      { requires: 'connection', run: (n) => openServerInfo(n, 'replica', 'Replica Set Status') },

    // ── database-scoped modals ──
    'Database Statistics':     modalFeature('dbStats'),
    'Query Profiler':          modalFeature('profiler'),
    'Manage Users':            modalFeature('users'),
    'Manage Roles':            modalFeature('roles'),
    'Stored Functions':        modalFeature('functions'),
    'GridFS…':                 modalFeature('gridfs'),
    'Search in…':              { requires: 'database', run: (n) => openSearchTab(pick(n, DB)) },

    // ── collection-scoped modals ──
    'Add / Edit Validator…':   modalFeature('validator'),
    'View Schema':             { requires: 'collection', run: (n) => openSchemaTab(pick(n, COLL)) },
    'Collection History':      modalFeature('history'),
    'Collection Stats':        modalFeature('stats'),
    'Open Map-Reduce':         modalFeature('mapReduce'),

    // ── create/edit dialogs (state + seeders owned by useDbActions) ──
    'Add Collection…':         modalFeature('addCollection'),
    'Add Database…':           modalFeature('addDatabase'),
    'Add View…':               { requires: 'database',   run: (n) => openAddView(n, '') },
    'Add View Here…':          { requires: 'collection', run: (n) => openAddView(n, n.collName || '') },
    'Add GridFS Bucket…':      modalFeature('addBucket'),
    'Drop Database…':          modalFeature('dropDatabase'),
    'Drop Collection…':        modalFeature('dropCollection'),
    'Rename Collection…':      modalFeature('renameCollection'),
    'Duplicate Collection…':   modalFeature('duplicateCollection'),

    // ── import / export (collection-level wizards; db-level exports many) ──
    'Export…':                 { requires: 'collection', run: (n) => openExportSource(pick(n, COLL)) },
    'Import…':                 { requires: 'collection', run: (n) => openImportWizard(pick(n, COLL)) },
    'Export Collections…':     { requires: 'database',   run: (n) => exportDatabase(pick(n, COLL)) },
    'Import Collections…':     { requires: 'database',   run: (n) => importDatabase(pick(n, COLL)) },

    // ── clipboard / copy-paste ──
    'Copy Name':               { requires: null,         run: (n, ctx) => { navigator.clipboard.writeText(ctx.label); showToast('Copied') } },
    'Copy Collection':         { requires: 'collection', run: (n) => copyToClipboard(n, 'collection') },
    'Copy Database':           { requires: 'database',   run: (n) => copyToClipboard(n, 'database') },
    'Paste Into Database':     { requires: 'database',   run: (n) => pasteClipboard(pick(n, COLL)) },

    // ── connection lifecycle ──
    'Disconnect':              { requires: 'connection', run: disconnectOne },
    'Disconnect Others':       { requires: 'connection', run: disconnectOthers },
    'Disconnect All':          { requires: null,         run: disconnectAll },
    'Refresh Selected Item':   { requires: 'connection', run: refreshSelected },
    'Refresh':                 { requires: 'connection', run: refreshSelected },
    'Refresh All':             { requires: null,         run: refreshAll },
  }

  // True when a node carries the fields a given level needs.
  function hasLevel(node, requires) {
    if (requires === 'connection') return !!node.connId
    if (requires === 'database')   return !!node.connId && !!node.dbName
    if (requires === 'collection') return !!node.connId && !!node.dbName && !!node.collName
    return true
  }
  function levelHint(requires) {
    if (requires === 'collection') return 'Open a collection first'
    if (requires === 'database')   return 'Open a database or collection first'
    return 'Open a connection, database, or collection first'
  }

  // Single dispatch point for the feature registry. `ctx` carries extras a handler
  // may want (e.g. the clicked node's display label).
  function runFeature(action, node, ctx = {}) {
    const feat = FEATURES[action]
    if (!feat) {
      if (UNBUILT_ACTIONS.has(action)) { showToast(action + ' — coming to OzenDB'); return }
      // Offered by a menu but unknown here: a wiring bug, not a placeholder. Say so
      // loudly rather than telling the user their feature was never built.
      console.error(`useFeatures: no handler registered for action "${action}"`)
      showToast(`Could not run "${action}"`)
      return
    }
    if (feat.requires && !hasLevel(node, feat.requires)) { showToast(levelHint(feat.requires)); return }
    return feat.run(node, ctx)
  }

  async function handleContextAction(action) {
    const saved = contextMenu.value
    contextMenu.value = null

    // Tab context menu (right-click on a tab) routes to its own handler.
    if (saved.type === 'tab') {
      handleTabAction(action, saved.nodeData.tabId)
      return
    }

    // Choose Color carries the picked color as an ":<color>" suffix.
    if (action.startsWith('Choose Color:')) {
      try {
        await applyColorTag({ type: saved.type, nodeData: saved.nodeData, color: action.split(':')[1] })
      } catch (e) {
        showToast(`Could not save color tag: ${errText(e)}`)
      }
      return
    }

    return runFeature(action, saved.nodeData, { label: saved.label })
  }

  // Toolbar / native-menu tool dispatch. `connect`/`sql` are app-level (no
  // node); `collection`/`shell` keep their bespoke selection + guidance logic; every
  // other tool resolves the operating node (the passed sidebar selection, else the
  // active tab) and routes through the shared feature registry.
  function handleTool(name, target = null) {
    if (name === 'connect') { openModal('connectionManager'); return }

    if (name === 'collection') {
      if (target && target.connectionId && target.dbName && target.collectionName) {
        openCollectionTab({
          connectionId: target.connectionId,
          connectionName: target.connectionName,
          dbName: target.dbName,
          collectionName: target.collectionName,
        })
        return
      }
      // Opens the collection highlighted in the sidebar, same as double-clicking it.
      // Opening makes it the active collection, whose highlight takes over — so the
      // single-click selection is cleared rather than lingering as a second one.
      const sel = treeSelection.value
      if (!sel || sel.kind !== 'collection') {
        showToast('Select a collection in the sidebar first')
        return
      }
      setTreeSelection(null)
      openCollectionTab(sel)
      return
    }

    // The remaining actions operate on a specific node. From the toolbar that's the
    // active workspace; from the native menu the caller passes an already-resolved
    // target. Only the former needs normalising — and it must be, because a tool
    // workspace spells its fields connId/collName, so reading the long names straight
    // off it yields undefined and the action degrades into a "select something first"
    // toast while a perfectly good collection is on screen.
    const tab = target || workspaceTarget(activeTab.value)

    if (name === 'shell') {
      if (tab && tab.connectionId && tab.dbName) {
        openShellTab({
          connectionId: tab.connectionId,
          connectionName: tab.connectionName,
          dbName: tab.dbName,
        })
      } else {
        showToast('Select a database or collection first to open IntelliShell')
      }
      return
    }

    if (name === 'sql') {
      if (tab && tab.connectionId && tab.dbName && tab.collectionName) {
        openSqlTab({
          connectionId: tab.connectionId,
          connectionName: tab.connectionName,
          dbName: tab.dbName,
          collectionName: tab.collectionName,
        })
      } else {
        showToast('Select a collection first to open SQL')
      }
      return
    }

    const action = TOOL_ALIASES[name]
    if (action) {
      runFeature(action, tabNode(tab))
      return
    }
    // Every entry in TOOLS is handled above or via TOOL_ALIASES, so reaching here
    // means the toolbar grew a button nobody wired up.
    const label = TOOLS.find(t => t.name === name)?.label || name
    console.error(`useFeatures: no handler registered for tool "${name}"`)
    showToast(`Could not run "${label}"`)
  }

  // Bridges a native-menu item into the feature registry by synthesizing the
  // "selected node" from the current target (sidebar selection, or the active tab).
  // `requiredType` guards the action; guides the user when context is missing.
  function menuNode(action, requiredType) {
    const tab = menuTarget(requiredType)
    if (!tab || !tab.connectionId) {
      showToast('Open a connection, database, or collection first')
      return
    }
    if (requiredType === 'collection' && (tab.kind !== 'collection' || !tab.collectionName)) {
      showToast('Open a collection first')
      return
    }
    if (requiredType === 'database' && !tab.dbName) {
      showToast('Open a database or collection first')
      return
    }
    const node = {
      connId: tab.connectionId,
      connName: tab.connectionName,
      dbName: tab.dbName,
      collName: tab.collectionName,
    }
    const label = tab.collectionName || tab.dbName || tab.connectionName
    runFeature(action, node, { label: label })
  }

  return {
    // Exposed so contextMenus can be checked against what is actually dispatchable
    // (see the coverage spec); FEATURES itself closes over injected dependencies.
    knownActions: new Set(Object.keys(FEATURES)),
    handleContextAction: handleContextAction,
    handleTool: handleTool,
    menuNode: menuNode,
    runFeature: runFeature,
    refreshAll,
  }
}
