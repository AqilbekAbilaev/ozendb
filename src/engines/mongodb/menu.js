// MongoDB's switches for the native menu (menu.rs's MongoDB gates), merged into the
// shared context by deriveMenuContext (utils/menuContext.js), and the node its items act on.
import { selectedIndex } from './admin/indexes.js'
import { workspaceIsCollection } from '../../workspaces/registry.js'
import { selectedGridfsFile } from './tools/gridfsSelection.js'

// How many segments each gated level needs.
const DEPTH = { connection: 0, database: 1, collection: 2 }

// Every item behind the connection/database/collection gates is a MongoDB action, so
// only a MongoDB selection or tab counts toward them — a PostgreSQL one names no
// resource here, and an action can never be handed one. No engine means MongoDB (a
// selection or tab from before engines existed).
function mongoResource(source, ref) {
  return (source?.engine ?? 'mongodb') === 'mongodb' ? ref : null
}

// -1 for "names no resource", so every comparison against a depth is false for it.
function depth(ref) {
  return ref ? ref.segments.length : -1
}

function tabDepth(tab) {
  return depth(mongoResource(tab, tab?.target ?? null))
}

function selectionDepth(treeSelection) {
  return depth(mongoResource(treeSelection, treeSelection?.resource))
}

// The dialog selections and whether the tab is a collection tab are read here rather
// than passed in, so the shared code never learns which state only MongoDB gates on.
function switches({ activeTab, treeSelection }) {
  const tab = activeTab || null
  const reaches = (level) => tabDepth(tab) >= DEPTH[level] || selectionDepth(treeSelection) >= DEPTH[level]

  // Document/field selection is a property of the ACTIVE collection tab's results
  // view only — never the sidebar. The Document menu acts on the row/field the user
  // has selected in the grid, which only exists while a collection tab is active and
  // has run a query. A field selection implies a row selection.
  const isCollection = workspaceIsCollection(tab)
  const rowCount = isCollection ? (tab.runtime.results?.length ?? 0) : 0
  const selectedRow = isCollection ? (tab.runtime.selectedRow ?? -1) : -1
  const hasDocument = selectedRow >= 0 && selectedRow < rowCount

  return {
    hasConnection: reaches('connection'),
    hasDatabase: reaches('database'),
    hasCollection: reaches('collection'),
    hasDocument: hasDocument,
    hasField: hasDocument && !!(tab && tab.runtime.selectedField),
    // Index-menu actions operate on the index selected in the Indexes dialog, which
    // is independent of the tab/tree selection.
    hasIndex: !!selectedIndex.value,
    // Same for the GridFS dialog's selected file (see Gate::GridfsFile).
    hasGridfsFile: !!selectedGridfsFile.value,
  }
}

export const mongoMenu = Object.freeze({
  switches: switches,
  // Any MongoDB row in the sidebar enables at least the Connection menu.
  selectionEnables: (treeSelection) => selectionDepth(treeSelection) >= 0,
  // An active MongoDB tab counts as an open connection for Refresh All Connections.
  tabNamesConnection: (tab) => tabDepth(tab) >= 0,
})

// A resolved target: the ref, and beside it the connection's display name, the one piece
// of presentation a ref cannot carry, read off the source.
function nodeFrom(source, ref) {
  return ref ? { resource: ref, connectionName: source?.connectionName ?? source?.connName ?? null } : null
}

// The node a native menu action should act on. Because item enablement is the
// UNION of the active tab and the sidebar selection (see deriveMenuContext), the
// target must be whichever of the two actually satisfies the action's depth —
// otherwise a shallow sidebar click could steal an item that only the deeper
// active tab enabled. The sidebar selection wins when both qualify (that's what
// the user just clicked); we fall back to the active tab when the selection is too
// shallow. `requiredLevel` is 'connection' | 'database' | 'collection' | null. The result
// is `{ resource, connectionName }`, or null when neither names a MongoDB resource.
export function resolveMenuTarget(activeTab, treeSelection, requiredLevel = null) {
  const sel = treeSelection || null
  const tab = activeTab || null
  const selRef = mongoResource(sel, sel?.resource ?? null)
  const tabRef = mongoResource(tab, tab?.target ?? null)
  const needed = DEPTH[requiredLevel] ?? DEPTH.connection

  if (depth(selRef) >= needed) return nodeFrom(sel, selRef)
  if (depth(tabRef) >= needed) return nodeFrom(tab, tabRef)
  // Neither is deep enough: hand back the shallower of the two anyway, so the caller
  // can name what is selected in its guide message.
  return nodeFrom(sel, selRef) || nodeFrom(tab, tabRef)
}
