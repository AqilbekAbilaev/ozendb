import { disconnect } from '../appApi/connections'
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
import { COLOR_ACTION } from '../constants/contextMenus'
import { activeTab, closeWhere, handleTabAction } from '../stores/tabs'
import { affectedByResource } from '../workspaces/lifecycle'
import { createResourceRef, resourceKind, resourceName } from '../utils/resourceRef'
import { resourceFromFeatureNode, resourceFromTreeSelection } from '../utils/legacyResourceRef'
import { resolveMenuTarget } from '../utils/menuContext'
import { errText } from '../utils/errors'
import { refreshConnectionResources } from '../stores/connectionData'
import { openConnections, closeConnection } from '../stores/openConnections'
import { openModal } from '../stores/modals'
import { contextAction } from '../engines/contextActions.js'
import { runPgTool } from '../engines/postgresql/toolbarActions'

// Node-action dispatch layer, shared by the right-click menu (@pick →
// handleContextAction), the native menu bar (handleMenuAction → menuNode →
// handleContextAction) and the toolbar (@tool → handleTool). Every action is
// described once in FEATURES: the node level it needs and what it does. A handler
// receives the node as a ResourceRef plus a `ctx` carrying its presentation — the
// connection's display name and the clicked row's label — which a ref never holds.
// Each entry point converts its own shape into a ref once, on the way in.
//
// Dependencies are injected so this stays UI-agnostic and testable: `dbActions` is the
// sibling composable API; the rest are shared refs and the tab creators, which remain in
// App.vue. Tab state comes from the store; modals open through stores/modals.js directly.
// Context-menu entries that are deliberately offered but not implemented yet, by id,
// with the name the "coming soon" toast uses. Naming them is what lets an unrecognised
// id be treated as the wiring bug it is rather than as a placeholder.
export const UNBUILT_ACTIONS = new Map([
  ['db:duplicate', 'Duplicate Database…'],
  ['conn:export_uri', 'Export URI…'],
])

// `menuTarget` comes from useMenu, which App.vue constructs once because it also
// owns the watcher that pushes the menu context to the native menu.
export function useFeatures({ menuTarget, pgMenuTarget }) {
  const { pasteClipboard } = useDbActions()
  const { applyColorTag } = useNodeTags()
  const { openImportWizard, exportDatabase, importDatabase } = useDbTransfer()

  // How many segments each level's resource has.
  const DEPTH = { connection: 0, database: 1, collection: 2 }

  // Toolbar tool name → registry action. Tools whose behavior is app-level
  // (connect/sql) or bespoke (collection/shell) are handled in handleTool.
  const TOOL_ALIASES = {
    aggregate: 'coll:aggregation',
    export:    'coll:export',
    import:    'coll:import',
    schema:    'coll:schema',
    search:    'file:search',
  }

  // The node's resource cut to `level` — a database action run on a collection row acts
  // on that row's database — in the long alias spelling the tab creators and modals
  // read. Only the fields the level names are present.
  function target(ref, ctx, level) {
    const [database, collection] = ref.segments
    return {
      connectionId: ref.connectionId,
      connectionName: ctx.connectionName,
      ...(DEPTH[level] >= DEPTH.database ? { dbName: database.name } : {}),
      ...(DEPTH[level] >= DEPTH.collection ? { collectionName: collection.name } : {}),
    }
  }

  // The same, in the short alias spelling the tool tabs, the transfer wizards and the
  // clipboard still read. It goes when those take a ResourceRef (the rest of #193).
  function toolTarget(ref, ctx, level) {
    const long = target(ref, ctx, level)
    return {
      connId: long.connectionId,
      connName: long.connectionName,
      ...('dbName' in long ? { dbName: long.dbName } : {}),
      ...('collectionName' in long ? { collName: long.collectionName } : {}),
    }
  }

  // A modal's target: the node's resource cut to `level`, with the connection's display
  // name beside it, since a ref never carries one. Modals read names off the ref.
  function modalTarget(ref, ctx, level) {
    return {
      resource: createResourceRef(ref.connectionId, ref.segments.slice(0, DEPTH[level])),
      connectionName: ctx.connectionName,
    }
  }

  // Add View is the one structural dialog whose payload isn't just the node's level fields:
  // it carries the source collection to prefill (empty from a database node, the clicked
  // collection from "Add View Here…"), so it opens directly instead of via modalFeature.
  function openAddView(ref, ctx, source) {
    openModal('addView', { ...modalTarget(ref, ctx, 'database'), source: source })
  }

  // A registry-driven modal feature (see constants/modalRegistry.js): its level and
  // component are declared once in MODALS, so the feature is named by id alone and opens
  // the registry modal with the target that level needs. Connection- and database-level
  // modals take a ResourceRef; collection-level ones move next (#193), and this branch
  // goes with them.
  function modalFeature(id) {
    const level = MODALS[id].level
    const make = level === 'collection' ? target : modalTarget
    return { requires: level, run: (ref, ctx) => openModal(id, make(ref, ctx, level)) }
  }

  async function disconnectOne(ref, ctx) {
    try { await disconnect(ref.connectionId) } catch (_) {}
    await closeConnection(ref.connectionId)
    // Every tab scoped into this connection is stale once it's gone — including tool
    // tabs, whose short alias keys the old filter could never see. Containment runs
    // disposal (shell teardown) through closeTab for each affected workspace.
    closeWhere(affectedByResource(createResourceRef(ref.connectionId)))
    showToast('Disconnected from ' + ctx.label)
  }
  async function disconnectOthers(ref) {
    // Snapshot first: closing mutates the list the loop is reading.
    const others = openConnections.value.filter(c => c.id !== ref.connectionId)
    for (const conn of others) {
      try { await disconnect(conn.id) } catch (_) {}
      await closeConnection(conn.id)
    }
    // Keep every tab scoped under the surviving connection; close all other
    // resource-scoped tabs. The old filter closed every non-collection tab — it
    // killed shells that were still valid and kept stale ones on dropped connections.
    const keep = affectedByResource(createResourceRef(ref.connectionId))
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
  async function refreshSelected(ref) {
    try {
      await refreshConnectionResources(ref.connectionId)
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

  function openServerInfo(ref, ctx, kind, title) {
    openModal('serverInfo', {
      ...modalTarget(ref, ctx, 'connection'), kind: kind, title: title,
    })
  }
  function copyToClipboard(ref, ctx, kind) {
    const copied = toolTarget(ref, ctx, kind)
    dbClipboard.value = { kind: kind, ...copied }
    showToast(`Copied ${kind} "${kind === 'collection' ? copied.collName : copied.dbName}"`)
  }

  // Keyed by action id; the labels menus show are theirs, not ours. Ids match the
  // native menu's where it offers the same action.
  const FEATURES = {
    // ── open a tab ──
    'coll:open_tab':           { requires: 'collection', run: (r, c) => openCollectionTab(target(r, c, 'collection')) },
    'coll:aggregation':        { requires: 'collection', run: (r, c) => openCollectionTab(target(r, c, 'collection'), 'aggregate') },
    'file:intellishell':       { requires: 'database',   run: (r, c) => openShellTab(target(r, c, 'database')) },
    'coll:add_index':          { requires: 'collection', run: (r, c) => openIndexManagerTab(toolTarget(r, c, 'collection')) },

    // ── connection-scoped info modals ──
    'file:server_status':      modalFeature('serverStatus'),
    'file:server_charts':      modalFeature('serverCharts'),
    'db:current_ops':          { requires: 'connection', run: (r, c) => openCurrentOpsTab(toolTarget(r, c, 'connection')) },
    'file:server_build':       { requires: 'connection', run: (r, c) => openServerInfo(r, c, 'build',   'Build Info') },
    'conn:host_info':          { requires: 'connection', run: (r, c) => openServerInfo(r, c, 'host',    'Host Info') },
    'conn:replica_status':     { requires: 'connection', run: (r, c) => openServerInfo(r, c, 'replica', 'Replica Set Status') },

    // ── database-scoped modals ──
    'db:database_stats':       modalFeature('dbStats'),
    'db:profiler':             modalFeature('profiler'),
    'db:manage_users':         modalFeature('users'),
    'db:manage_roles':         modalFeature('roles'),
    'db:functions':            modalFeature('functions'),
    'gridfs:open':             modalFeature('gridfs'),
    'file:search':             { requires: 'database', run: (r, c) => openSearchTab(toolTarget(r, c, 'database')) },

    // ── collection-scoped modals ──
    'coll:validator':          modalFeature('validator'),
    'coll:schema':             { requires: 'collection', run: (r, c) => openSchemaTab(toolTarget(r, c, 'collection')) },
    'coll:history':            modalFeature('history'),
    'coll:stats':              modalFeature('stats'),
    'coll:mapreduce':          modalFeature('mapReduce'),

    // ── create/edit dialogs (state + seeders owned by useDbActions) ──
    'db:add_collection':       modalFeature('addCollection'),
    'db:add_database':         modalFeature('addDatabase'),
    'db:add_view':             { requires: 'database',   run: (r, c) => openAddView(r, c, '') },
    'coll:add_view':           { requires: 'collection', run: (r, c) => openAddView(r, c, resourceName(r)) },
    'db:add_bucket':           modalFeature('addBucket'),
    'db:drop_database':        modalFeature('dropDatabase'),
    'coll:drop':               modalFeature('dropCollection'),
    'coll:rename':             modalFeature('renameCollection'),
    'coll:duplicate':          modalFeature('duplicateCollection'),

    // ── import / export (collection-level wizards; db-level exports many) ──
    'coll:export':             { requires: 'collection', run: (r, c) => openExportSource(toolTarget(r, c, 'collection')) },
    'coll:import':             { requires: 'collection', run: (r, c) => openImportWizard(toolTarget(r, c, 'collection')) },
    'db:export':               { requires: 'database',   run: (r, c) => exportDatabase(toolTarget(r, c, resourceKind(r))) },
    'db:import':               { requires: 'database',   run: (r, c) => importDatabase(toolTarget(r, c, resourceKind(r))) },

    // ── clipboard / copy-paste ──
    'node:copy_name':          { requires: null,         run: (r, c) => { navigator.clipboard.writeText(c.label); showToast('Copied') } },
    'coll:copy':               { requires: 'collection', run: (r, c) => copyToClipboard(r, c, 'collection') },
    'db:copy_database':        { requires: 'database',   run: (r, c) => copyToClipboard(r, c, 'database') },
    'db:paste':                { requires: 'database',   run: (r, c) => pasteClipboard(toolTarget(r, c, resourceKind(r))) },

    // ── connection lifecycle ──
    'conn:disconnect':         { requires: 'connection', run: disconnectOne },
    'conn:disconnect_others':  { requires: 'connection', run: disconnectOthers },
    'conn:disconnect_all':     { requires: null,         run: disconnectAll },
    'node:refresh':            { requires: 'connection', run: refreshSelected },
    'view:refresh_all':        { requires: null,         run: refreshAll },
  }

  // True when the resource is at least as deep as the level an action needs.
  function hasLevel(ref, requires) {
    if (!requires) return true
    return !!ref && ref.segments.length >= DEPTH[requires]
  }
  function levelHint(requires) {
    if (requires === 'collection') return 'Open a collection first'
    if (requires === 'database')   return 'Open a database or collection first'
    return 'Open a connection, database, or collection first'
  }

  // Single dispatch point for the feature registry. `ref` is the node's ResourceRef, or
  // null when nothing is selected; `ctx` carries its presentation (connectionName, label).
  function runFeature(action, ref, ctx = {}) {
    const feat = FEATURES[action]
    if (!feat) {
      if (UNBUILT_ACTIONS.has(action)) { showToast(UNBUILT_ACTIONS.get(action) + ' — coming to OzenDB'); return }
      // Offered by a menu but unknown here: a wiring bug, not a placeholder. Say so
      // loudly rather than telling the user their feature was never built.
      console.error(`useFeatures: no handler registered for action "${action}"`)
      showToast(`Could not run "${action}"`)
      return
    }
    if (!hasLevel(ref, feat.requires)) { showToast(levelHint(feat.requires)); return }
    return feat.run(ref, ctx)
  }

  async function handleContextAction(action) {
    const saved = contextMenu.value
    contextMenu.value = null

    // Tab context menu (right-click on a tab) routes to its own handler.
    if (saved.type === 'tab') {
      handleTabAction(action, saved.nodeData.tabId)
      return
    }

    // The colour submenu's pick carries the colour after COLOR_ACTION.
    if (action.startsWith(COLOR_ACTION)) {
      try {
        await applyColorTag({ type: saved.type, nodeData: saved.nodeData, color: action.slice(COLOR_ACTION.length) })
      } catch (e) {
        showToast(`Could not save color tag: ${errText(e)}`)
      }
      return
    }

    const engineAction = contextAction(saved.nodeData, action)
    if (engineAction) return engineAction(saved.nodeData)
    // The tree's rows still hand over the short-alias node; this is where it becomes a ref.
    const ref = resourceFromFeatureNode(saved.nodeData)
    return runFeature(action, ref, { label: saved.label, connectionName: saved.nodeData.connName })
  }

  // Toolbar / native-menu tool dispatch. `connect`/`sql` are app-level (no
  // node); PostgreSQL's buttons go to runPgTool; `collection`/`shell` keep their bespoke
  // selection + guidance logic; every other tool resolves the operating node (the passed
  // sidebar selection, else the active tab) and routes through the shared feature registry.
  function handleTool(name, target = null) {
    if (name === 'connect') { openModal('connectionManager'); return }
    if (runPgTool(name, pgMenuTarget)) return

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

    // The remaining actions operate on a specific node. From the native menu the caller
    // passes an already-resolved target; from the toolbar it is the active workspace,
    // resolved the way the menu resolves it — through its target, and only when that
    // names a MongoDB resource.
    const tab = target || resolveMenuTarget(activeTab.value, null)

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
      runFeature(action, resourceFromTreeSelection(tab), { connectionName: tab?.connectionName })
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
  // `requiredType` (the feature's own level unless given) guards the action and guides
  // the user when context is missing.
  function menuNode(action, requiredType = FEATURES[action]?.requires ?? null) {
    const tab = menuTarget(requiredType)
    const ref = resourceFromTreeSelection(tab)
    if (!ref || !hasLevel(ref, requiredType)) {
      showToast(levelHint(requiredType))
      return
    }
    const label = resourceName(ref) || tab.connectionName
    runFeature(action, ref, { label: label, connectionName: tab.connectionName })
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
