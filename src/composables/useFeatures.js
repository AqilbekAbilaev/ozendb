import { disconnect } from '../engines/mongodb/api/connections'
import { TOOLS } from '../constants/tools'
import { MODALS } from '../constants/modalRegistry'
import { activeTab, closeWhere } from '../stores/tabs'
import { affectedByResource } from '../workspaces/lifecycle'
import { createResourceRef } from '../utils/resourceRef'
import { errText } from '../utils/errors'

// Node-action dispatch layer, shared by the right-click menu (@pick →
// handleContextAction), the native menu bar (handleMenuAction → menuNode →
// handleContextAction) and the toolbar (@tool → handleTool). Every action is
// described once in FEATURES: the node level it needs and what it does. A "node"
// here is the normalized shape { connId, connName, dbName, collName }.
//
// Dependencies are injected so this stays UI-agnostic and testable: `modals`/
// `dbActions` are the sibling composable APIs; the rest are shared refs and the
// tab creators, which remain in App.vue. Tab state comes from the store.
export function useFeatures({
  // shared reactive state
  contextMenu, connectionTreeRef, dbClipboard,
  // sibling composable APIs
  modals, dbActions,
  // injected functions
  showToast, applyColorTag, menuTarget,
  handleTabAction, openCollectionTab, openShellTab, openIndexManagerTab, openSqlTab,
  openSchemaTab, openSearchTab, openCurrentOpsTab,
  openExportSource, openImportWizard, exportDatabase, importDatabase,
}) {
  const { pasteClipboard } = dbActions

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
    modals.openModal('addView', { ...pick(node, DB), source: source })
  }

  // A feature that simply opens a modal by copying node fields into its target ref.
  function modal(target, requires, fields) {
    return { requires: requires, run: (node) => { target.value = pick(node, fields) } }
  }

  // A registry-driven modal feature (see constants/modalRegistry.js): its level and
  // component are declared once in MODALS, so the feature is named by id alone and opens
  // the registry modal with the node fields that level needs.
  const LEVEL_FIELDS = { connection: CONN, database: DB, collection: COLL }
  function modalFeature(id) {
    const level = MODALS[id].level
    return { requires: level, run: (node) => modals.openModal(id, pick(node, LEVEL_FIELDS[level])) }
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
    connectionTreeRef.value.disconnectConn(node.connId)
    // Every tab scoped into this connection is stale once it's gone — including tool
    // tabs, whose short alias keys the old filter could never see. Containment runs
    // disposal (shell teardown) through closeTab for each affected workspace.
    closeWhere(affectedByResource(createResourceRef(node.connId)))
    showToast('Disconnected from ' + ctx.label)
  }
  async function disconnectOthers(node) {
    const others = connectionTreeRef.value.getConnections().filter(c => c.id !== node.connId)
    for (const conn of others) {
      try { await disconnect(conn.id) } catch (_) {}
      connectionTreeRef.value.disconnectConn(conn.id)
    }
    // Keep every tab scoped under the surviving connection; close all other
    // resource-scoped tabs. The old filter closed every non-collection tab — it
    // killed shells that were still valid and kept stale ones on dropped connections.
    const keep = affectedByResource(createResourceRef(node.connId))
    closeWhere(t => !!t.target && !keep(t))
    showToast('Disconnected all other connections')
  }
  async function disconnectAll() {
    for (const conn of connectionTreeRef.value.getConnections()) {
      try { await disconnect(conn.id) } catch (_) {}
      connectionTreeRef.value.disconnectConn(conn.id)
    }
    // Every resource-scoped tab belongs to a now-disconnected connection; only
    // resource-less workspaces (Quickstart) survive.
    closeWhere(t => !!t.target)
    showToast('All connections closed')
  }
  async function refreshSelected(node) {
    await connectionTreeRef.value.refreshConn(node.connId)
    showToast('Refreshed')
  }
  async function refreshAll() {
    for (const conn of connectionTreeRef.value.getConnections()) {
      await connectionTreeRef.value.refreshConn(conn.id)
    }
    showToast('All connections refreshed')
  }

  function openServerInfo(node, kind, title) {
    modals.openModal('serverInfo', { connId: node.connId, connName: node.connName, kind: kind, title: title })
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
    if (!feat) { showToast(action + ' — coming to OzenDB'); return }
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
    if (name === 'connect') { modals.openModal('connectionManager'); return }

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
      // Opens the collection currently highlighted in the sidebar, same as
      // double-clicking it. Guides the user when nothing is highlighted.
      if (!connectionTreeRef.value.openSelectedCollection()) {
        showToast('Select a collection in the sidebar first')
      }
      return
    }

    // The remaining actions operate on a specific node. From the toolbar that's the
    // active tab; from the native menu the caller passes the sidebar selection.
    const tab = target || activeTab.value

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
    const label = TOOLS.find(t => t.name === name)?.label || name
    showToast(`${label} — coming to OzenDB`)
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
    handleContextAction: handleContextAction,
    handleTool: handleTool,
    menuNode: menuNode,
    runFeature: runFeature,
  }
}
