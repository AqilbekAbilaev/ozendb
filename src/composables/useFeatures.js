import { disconnect } from '../appApi/connections'
import { showToast } from '../stores/toast'
import { useNodeTags } from './useNodeTags'
import { contextMenu } from '../stores/contextMenu'
import { TOOLS } from '../constants/tools'
import { COLOR_ACTION } from '../constants/contextMenus'
import { closeWhere, handleTabAction } from '../stores/tabs'
import { affectedByResource } from '../workspaces/lifecycle'
import { createResourceRef, resourceAt, resourceName } from '../utils/resourceRef'
import { errText } from '../utils/errors'
import { refreshConnectionResources } from '../stores/connectionData'
import { openConnections, closeConnection } from '../stores/openConnections'
import { openModal } from '../stores/modals'
import { contextAction, useEngineActions, runEngineTool, levelledMenuTarget } from '../engines/contextActions.js'

// Node-action dispatch layer, shared by the right-click menu (@pick →
// handleContextAction), the native menu bar (handleMenuAction → menuNode →
// handleContextAction) and the toolbar (@tool → handleTool). Every action is
// described once in FEATURES: the node level it needs and what it does. The shared
// actions are here; each engine's own come from engines/contextActions.js. A handler
// receives the node as a ResourceRef plus a `ctx` carrying its presentation — the
// connection's display name and the clicked row's label — which a ref never holds.
// Each entry point converts its own shape into a ref once, on the way in.
//
// Tab state comes from the store; modals open through stores/modals.js directly.
// Context-menu entries that are deliberately offered but not implemented yet, by id,
// with the name the "coming soon" toast uses. Naming them is what lets an unrecognised
// id be treated as the wiring bug it is rather than as a placeholder.
export const UNBUILT_ACTIONS = new Map([
  ['db:duplicate', 'Duplicate Database…'],
  ['conn:export_uri', 'Export URI…'],
])

export function useFeatures() {
  const { applyColorTag } = useNodeTags()

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

  // Keyed by action id; the labels menus show are theirs, not ours. Ids match the
  // native menu's where it offers the same action.
  const FEATURES = {
    ...useEngineActions(),

    // ── copy ──
    'node:copy_name':          { requires: null,         run: (r, c) => { navigator.clipboard.writeText(c.label); showToast('Copied') } },

    // ── connection lifecycle ──
    'conn:disconnect':         { requires: 'connection', run: disconnectOne },
    'conn:disconnect_others':  { requires: 'connection', run: disconnectOthers },
    'conn:disconnect_all':     { requires: null,         run: disconnectAll },
    'node:refresh':            { requires: 'connection', run: refreshSelected },
    'view:refresh_all':        { requires: null,         run: refreshAll },
  }

  // True when the resource reaches the level an action needs.
  function hasLevel(ref, requires) {
    if (!requires) return true
    return !!resourceAt(ref, requires)
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
    return runFeature(action, saved.nodeData.resource ?? null, {
      label: saved.label, connectionName: saved.nodeData.connectionName ?? null,
    })
  }

  // Toolbar tool dispatch. `connect` is app-level (no node); every other tool is an
  // engine's (engines/contextActions.js), which resolves the node it acts on.
  function handleTool(name) {
    if (name === 'connect') { openModal('connectionManager'); return }
    if (runEngineTool(name, { runFeature: runFeature })) return
    // Every entry in TOOLS is an engine's or `connect`, so reaching here means the
    // toolbar grew a button nobody wired up.
    const label = TOOLS.find(t => t.name === name)?.label || name
    console.error(`useFeatures: no handler registered for tool "${name}"`)
    showToast(`Could not run "${label}"`)
  }

  // Bridges a native-menu item into the feature registry by synthesizing the
  // "selected node" from the engine's menu target (sidebar selection, or the active tab).
  // `requiredType` (the feature's own level unless given) guards the action and guides
  // the user when context is missing.
  function menuNode(action, requiredType = FEATURES[action]?.requires ?? null) {
    const resolved = levelledMenuTarget(requiredType)
    const ref = resolved?.resource ?? null
    if (!ref || !hasLevel(ref, requiredType)) {
      showToast(levelHint(requiredType))
      return
    }
    const label = resourceName(ref) || resolved.connectionName
    runFeature(action, ref, { label: label, connectionName: resolved.connectionName })
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
