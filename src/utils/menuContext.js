// Pure logic for the native menu's enable/disable and action targeting. Extracted
// from App.vue so it can be unit-tested (see menuContext.test.js).
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
import { sameResource, segmentName } from './resourceRef'

// How many segments each gated level needs. Exported, with the helpers below, for the
// engines' own switches (engines/*/menu.js) while the resolvers here still need them (#476).
export const DEPTH = { connection: 0, database: 1, collection: 2 }

// PostgreSQL's own levels, one deeper than Mongo's: database/schema/table.
export const PG_DEPTH = { schema: 2, table: 3 }

// The mirror of mongoResource: only a PostgreSQL selection or tab counts toward the
// PostgreSQL gates. Depth alone cannot separate them — a Mongo collection is two
// segments deep, exactly as a Postgres schema is.
export function pgResource(source, ref) {
  return source?.engine === 'postgresql' ? ref : null
}

export const PG_TAB_TYPES = ['postgresql.query', 'postgresql.table_browse', 'postgresql.search']

// Every item behind the connection/database/collection gates is a MongoDB action, so
// only a MongoDB selection or tab counts toward them — a PostgreSQL one names no
// resource here, and an action can never be handed one. No engine means MongoDB (a
// selection or tab from before engines existed).
export function mongoResource(source, ref) {
  return (source?.engine ?? 'mongodb') === 'mongodb' ? ref : null
}

// Which engine's items the menu shows (#152); 'none' hides them all. A sidebar
// selection wins, as it does in resolveMenuTarget, but only when it enables something:
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

// -1 for "names no resource", so every comparison against a depth is false for it.
export function depth(ref) {
  return ref ? ref.segments.length : -1
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

// The PostgreSQL sibling of resolveMenuTarget (#145), with the same precedence:
// the sidebar selection wins when it is deep enough for the action, the active tab is
// the fallback, and `null` means neither can name a PostgreSQL target.
// `requiredLevel` is 'schema' | 'table' | null.
//
// Carries both the short alias PG_MENUS/PG_ACTIONS use (connId/connName) and the
// long alias collection/table-tab targets use (connectionId/connectionName) —
// the modals this feeds are a mix of both conventions (see ARCHITECTURE.md's resource-
// identity note on the two flat shapes still being live), and duplicating two
// fields here is simpler than a per-call-site remap.
export function resolvePgMenuTarget(activeTab, treeSelection = null, requiredLevel = null) {
  const sel = treeSelection || null
  const tab = activeTab || null
  const needed = PG_DEPTH[requiredLevel] ?? PG_DEPTH.schema

  if (depth(pgResource(sel, sel?.resource ?? null)) >= needed) return pgTarget(sel.resource, sel.connectionName)
  if (PG_TAB_TYPES.includes(tab?.type)) return pgTarget(tab.target, tab.connectionName)
  return null
}

// A PostgreSQL selection or tab, read off its ref (a tab keeps no flat identity, #303)
// into the database/schema/table fields every PostgreSQL consumer reads, and its engine
// for the shared SQL windows (engines/sql/admin).
function pgTarget(ref, connectionName) {
  return {
    connId: ref.connectionId,
    engine: 'postgresql',
    connName: connectionName,
    connectionId: ref.connectionId,
    connectionName: connectionName,
    database: segmentName(ref, 'database'),
    schema: segmentName(ref, 'schema'),
    table: segmentName(ref, 'table'),
  }
}
