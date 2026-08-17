// Pure logic for the native menu's enable/disable and action targeting. Extracted
// from App.vue so it can be unit-tested (see menuContext.test.js).
//
// The key fix these encode: the menu context is the UNION of the active tab and
// the sidebar/tree selection, so items enable when the user selects a
// connection/database/collection in the tree — not only when a matching tab is
// active (which at launch is always the context-less Quickstart tab).

// Which item groups should be enabled, given the active tab, the current sidebar
// selection, and how many connections are open.
//   activeTab      { connectionId, dbName, collectionName, kind } | null
//   treeSelection  { connectionId, dbName, collectionName, kind } | null
//   connectionCount  number of connections open in the tree
//   indexSelected  whether an index row is selected in the open Indexes dialog
export function deriveMenuContext(activeTab, treeSelection, connectionCount, indexSelected = false) {
  const tab = activeTab || null
  const sel = treeSelection || null
  const tabConnection = !!(tab && tab.connectionId)
  // Document/field selection is a property of the ACTIVE collection tab's results
  // view only — never the sidebar. The Document menu acts on the row/field the user
  // has selected in the grid, which only exists while a collection tab is active and
  // has run a query. A field selection implies a row selection.
  const rowCount = tab && tab.kind === 'collection' ? (tab.results?.length ?? 0) : 0
  const selectedRow = tab ? (tab.selectedRow ?? -1) : -1
  const hasDocument = selectedRow >= 0 && selectedRow < rowCount
  const hasField = hasDocument && !!(tab && tab.selectedField)
  return {
    hasConnection: tabConnection || !!(sel && sel.connectionId),
    hasDatabase: !!(tab && tab.connectionId && tab.dbName) || !!(sel && sel.dbName),
    hasCollection: !!(tab && tab.kind === 'collection' && tab.collectionName) || !!(sel && sel.collectionName),
    // Refresh acts on every open connection, so it enables whenever one exists.
    anyConnection: (connectionCount || 0) > 0 || tabConnection,
    hasDocument: hasDocument,
    hasField: hasField,
    // Index-menu actions operate on the index selected in the Indexes dialog, which
    // is independent of the tab/tree selection — so it's passed in directly.
    hasIndex: !!indexSelected,
    // The active tab's read-only lock disables the write actions (see writable.js).
    // Only the tab can carry it — the sidebar selection never locks anything.
    readOnly: !!(tab && tab.readOnly),
  }
}

// Does a tab-shaped target reach at least the given depth?
//   'collection' → a collection, 'database' → a db or collection,
//   'connection'/null → any connection.
function satisfiesLevel(target, requiredLevel) {
  if (!target || !target.connectionId) return false
  if (requiredLevel === 'collection') {
    return target.kind === 'collection' && !!target.collectionName
  }
  if (requiredLevel === 'database') return !!target.dbName
  return true
}

// The node a native menu action should act on. Because item enablement is the
// UNION of the active tab and the sidebar selection (see deriveMenuContext), the
// target must be whichever of the two actually satisfies the action's depth —
// otherwise a shallow sidebar click could steal an item that only the deeper
// active tab enabled. The sidebar selection wins when both qualify (that's what
// the user just clicked); we fall back to the active tab when the selection is too
// shallow. Returns a tab-shaped object so it drops straight into the existing
// handlers. `requiredLevel` is 'connection' | 'database' | 'collection' | null.
export function resolveMenuTarget(activeTab, treeSelection, requiredLevel = null) {
  const sel = treeSelection || null
  const tab = activeTab || null
  const selTarget = sel && sel.connectionId ? {
    connectionId: sel.connectionId,
    connectionName: sel.connectionName,
    dbName: sel.dbName || null,
    collectionName: sel.collectionName || null,
    kind: sel.collectionName ? 'collection' : (sel.dbName ? 'database' : 'connection'),
  } : null
  if (satisfiesLevel(selTarget, requiredLevel)) return selTarget
  if (satisfiesLevel(tab, requiredLevel)) return tab
  return selTarget || tab
}
