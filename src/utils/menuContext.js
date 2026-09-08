// Pure logic for the native menu's enable/disable and action targeting. Extracted
// from App.vue so it can be unit-tested (see menuContext.test.js).
//
// The key fix these encode: the menu context is the UNION of the active tab and
// the sidebar/tree selection, so items enable when the user selects a
// connection/database/collection in the tree — not only when a matching tab is
// active (which at launch is always the context-less Quickstart tab).
//
// Identity is a ResourceRef, never a set of tab fields. The tree hands its selection's
// ref straight over (see useConnectionTree); a tab's comes from its declared kind. So
// depth is counted once — segments — rather than re-derived per field per level, and a
// tab's scope is what it says it is rather than whichever fields happen to be set.
// That is what keeps Current Operations, which carries dbName/collName as *filters*,
// from enabling the Database menu.
//
// A workspace kind missing from legacyResourceRef's TAB_SCOPES resolves to no
// resource and gates everything off. That fails closed — a menu action can never fire
// against a target it could not identify — but it does mean a new workspace kind must
// be registered there or its menus stay dark.
import { resourceFromLegacyTab } from './legacyResourceRef'
import { resourceKind } from './resourceRef'

// How many segments each gated level needs.
const DEPTH = { connection: 0, database: 1, collection: 2 }

// -1 for "names no resource", so every comparison below is false for it.
function depth(ref) {
  return ref ? ref.segments.length : -1
}

// Which item groups should be enabled, given the active tab, the current sidebar
// selection, and how many connections are open.
//   activeTab      a workspace (any kind) | null
//   treeSelection  the tree's selection payload, carrying `resource` | null
//   connectionCount  number of connections open in the tree
//   indexSelected  whether an index row is selected in the open Indexes dialog
export function deriveMenuContext(activeTab, treeSelection, connectionCount, indexSelected = false) {
  const tab = activeTab || null
  const tabDepth = depth(resourceFromLegacyTab(tab))
  const selDepth = depth(treeSelection?.resource)
  const reaches = (level) => tabDepth >= DEPTH[level] || selDepth >= DEPTH[level]

  // Document/field selection is a property of the ACTIVE collection tab's results
  // view only — never the sidebar. The Document menu acts on the row/field the user
  // has selected in the grid, which only exists while a collection tab is active and
  // has run a query. A field selection implies a row selection.
  const rowCount = tab && tab.kind === 'collection' ? (tab.results?.length ?? 0) : 0
  const selectedRow = tab ? (tab.selectedRow ?? -1) : -1
  const hasDocument = selectedRow >= 0 && selectedRow < rowCount
  const hasField = hasDocument && !!(tab && tab.selectedField)
  return {
    hasConnection: reaches('connection'),
    hasDatabase: reaches('database'),
    hasCollection: reaches('collection'),
    // Refresh acts on every open connection, so it enables whenever one exists.
    anyConnection: (connectionCount || 0) > 0 || tabDepth >= 0,
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

// A resolved target, in the long alias spelling every handler already reads. Built
// from the ResourceRef rather than copied off the source, so a tool tab (which spells
// its fields connId/collName) resolves to the same shape as a collection tab — the
// handlers downstream cannot tell them apart, and must not have to.
function nodeFrom(source, ref) {
  if (!ref) return null
  const [database, collection] = ref.segments
  return {
    connectionId: ref.connectionId,
    // A display name, not identity — so it is the one field still read off the source.
    connectionName: source.connectionName ?? source.connName ?? null,
    dbName: database ? database.name : null,
    collectionName: collection ? collection.name : null,
    kind: resourceKind(ref),
  }
}

// The node a native menu action should act on. Because item enablement is the
// UNION of the active tab and the sidebar selection (see deriveMenuContext), the
// target must be whichever of the two actually satisfies the action's depth —
// otherwise a shallow sidebar click could steal an item that only the deeper
// active tab enabled. The sidebar selection wins when both qualify (that's what
// the user just clicked); we fall back to the active tab when the selection is too
// shallow. `requiredLevel` is 'connection' | 'database' | 'collection' | null.
export function resolveMenuTarget(activeTab, treeSelection, requiredLevel = null) {
  const sel = treeSelection || null
  const tab = activeTab || null
  const selRef = sel?.resource ?? null
  const tabRef = resourceFromLegacyTab(tab)
  const needed = DEPTH[requiredLevel] ?? DEPTH.connection

  if (depth(selRef) >= needed) return nodeFrom(sel, selRef)
  if (depth(tabRef) >= needed) return nodeFrom(tab, tabRef)
  // Neither is deep enough: hand back the shallower of the two anyway, so the caller
  // can name what is selected in its guide message.
  return nodeFrom(sel, selRef) || nodeFrom(tab, tabRef)
}
