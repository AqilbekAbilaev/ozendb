// Pure logic for the native menu's enable/disable. Extracted from App.vue so it can be
// unit-tested (see menuContext.test.js). Which node an item acts on is each engine's
// own (resolveMenuTarget in engines/mongodb/menu.js, resolvePgMenuTarget in
// engines/postgresql/menu.js).
//
// The key fix these encode: the menu context is the UNION of the active tab and
// the sidebar/tree selection, so items enable when the user selects a
// connection/database/collection in the tree — not only when a matching tab is
// active (which at launch is always the context-less Quickstart tab).
//
// Identity is a ResourceRef, never a set of tab fields. The tree hands its selection's
// ref straight over (see useConnectionTree); a tab's is the `target` its definition
// gave it. So depth is counted once — segments — rather than re-derived per field per
// level, and a tab's scope is what it says it is rather than whichever fields happen to
// be set. That is what keeps Current Operations, which carries dbName/collName as
// *filters*, from enabling the Database menu. A tab without a target (Quickstart)
// names no resource and gates everything off.
import { sameResource } from './resourceRef'

// Which engine's items the menu shows (#152); 'none' hides them all. A sidebar
// selection wins, as it does for an item's target, but only when it enables something:
// a PostgreSQL row above a schema enables nothing, so the tab decides instead.
function menuEngine(engines, tab, treeSelection) {
  const selected = engines.find(e => e.menu.selectionEnables(treeSelection))
  if (selected) return selected.id
  return engines.some(e => e.id === tab?.engine) ? tab.engine : 'none'
}

// MongoDB tabs carry the lock at the top level, PostgreSQL's table tab under `state`.
function isLocked(tab) {
  return !!(tab && (tab.readOnly || tab.state?.readOnly))
}

// Which item groups should be enabled: what every engine shares, merged with each
// engine's own switches (its `menu` entry, engines/*/menu.js).
//   activeTab        a workspace (any kind) | null
//   treeSelection    the tree's selection payload, carrying `resource` | null
//   connectionCount  number of connections open in the tree
//   canRefresh       whether the active tab can reload (workspaces/lifecycle's canRefreshWorkspace)
//   openTabs         every open workspace, for the lock of one showing the selected resource
//   engines          the engine table's entries; one without a `menu` has no items
export function deriveMenuContext({ activeTab = null, treeSelection = null, connectionCount = 0, canRefresh = false, openTabs = [], engines = [] }) {
  const withMenu = engines.filter(e => e.menu)
  return {
    ...Object.assign({}, ...withMenu.map(e => e.menu.switches({ activeTab, treeSelection }))),
    // Refresh acts on every open connection, so it enables whenever one exists.
    anyConnection: connectionCount > 0 || withMenu.some(e => e.menu.tabNamesConnection?.(activeTab)),
    // A read-only lock (see writable.js) disables the write actions: the active tab's,
    // or that of an open tab showing the sidebar selection, which a write may target.
    readOnly: isLocked(activeTab) || openTabs.some(t => isLocked(t) && sameResource(t.target, treeSelection?.resource)),
    // Refresh reloads the active tab, never the sidebar selection.
    canRefreshTab: !!canRefresh,
    engine: menuEngine(withMenu, activeTab, treeSelection),
  }
}
