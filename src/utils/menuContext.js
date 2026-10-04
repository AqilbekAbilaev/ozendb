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
import { resourceFromLegacyTab, legacyTargetFromResource } from './legacyResourceRef'

// How many segments each gated level needs.
const DEPTH = { connection: 0, database: 1, collection: 2 }

// PostgreSQL's own levels, one deeper than Mongo's: database/schema/table.
const PG_DEPTH = { schema: 2, table: 3 }

// The mirror of mongoResource: only a PostgreSQL selection or tab counts toward the
// PostgreSQL gates. Depth alone cannot separate them — a Mongo collection is two
// segments deep, exactly as a Postgres schema is.
function pgResource(source, ref) {
  return source?.engine === 'postgresql' ? ref : null
}

const PG_TAB_TYPES = ['postgresql.query', 'postgresql.table_browse']

// Every item behind the connection/database/collection gates is a MongoDB action, so
// only a MongoDB selection or tab counts toward them — a PostgreSQL one names no
// resource here, and an action can never be handed one. No engine means MongoDB (a
// selection or tab from before engines existed).
function mongoResource(source, ref) {
  return (source?.engine ?? 'mongodb') === 'mongodb' ? ref : null
}

// The engines the native menu has items of its own for (menu.rs's MenuEngine).
const MENU_ENGINES = ['mongodb', 'postgresql']

// Which engine's items the menu shows (ozendb-izk); 'none' hides both. A sidebar
// selection wins, as it does in resolveMenuTarget, but only when it enables something:
// a PostgreSQL row above a schema enables nothing, so the tab decides instead.
function menuEngine(tab, selDepth, pgSelDepth) {
  if (selDepth >= 0) return 'mongodb'
  if (pgSelDepth >= PG_DEPTH.schema) return 'postgresql'
  return MENU_ENGINES.includes(tab?.engine) ? tab.engine : 'none'
}

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
//   canRefresh     whether the active tab can reload (workspaces/lifecycle's canRefreshWorkspace)
export function deriveMenuContext(activeTab, treeSelection, connectionCount, indexSelected = false, canRefresh = false) {
  const tab = activeTab || null
  const tabDepth = depth(mongoResource(tab, resourceFromLegacyTab(tab)))
  const selDepth = depth(mongoResource(treeSelection, treeSelection?.resource))
  const reaches = (level) => tabDepth >= DEPTH[level] || selDepth >= DEPTH[level]

  // Document/field selection is a property of the ACTIVE collection tab's results
  // view only — never the sidebar. The Document menu acts on the row/field the user
  // has selected in the grid, which only exists while a collection tab is active and
  // has run a query. A field selection implies a row selection.
  const rowCount = tab && tab.kind === 'collection' ? (tab.results?.length ?? 0) : 0
  const selectedRow = tab ? (tab.selectedRow ?? -1) : -1
  const hasDocument = selectedRow >= 0 && selectedRow < rowCount
  const hasField = hasDocument && !!(tab && tab.selectedField)

  // PostgreSQL (ozendb-sxd), the same union as Connection/Database/Collection above:
  // a query tab names a schema, a table tab names a schema and a table, and the
  // sidebar contributes whichever level its clicked row named.
  const pgSelDepth = depth(pgResource(treeSelection, treeSelection?.resource))
  const pgReaches = (level) => pgSelDepth >= PG_DEPTH[level]
  const hasPgSchema = PG_TAB_TYPES.includes(tab?.type) || pgReaches('schema')
  const hasPgTable = tab?.type === 'postgresql.table_browse' || pgReaches('table')

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
    // MongoDB tabs carry it at the top level; PostgreSQL's table tab carries its
    // own accidental-edit lock nested under `state` instead (tableState.js).
    readOnly: !!(tab && (tab.readOnly || tab.state?.readOnly)),
    // Refresh reloads the active tab, never the sidebar selection.
    canRefreshTab: !!canRefresh,
    hasPgSchema: hasPgSchema,
    hasPgTable: hasPgTable,
    engine: menuEngine(tab, selDepth, pgSelDepth),
  }
}

// A resolved target, in the long alias spelling every handler already reads. The name
// is the one piece of presentation the ref cannot carry, so it is read off the source.
function nodeFrom(source, ref) {
  return legacyTargetFromResource(ref, source?.connectionName ?? source?.connName ?? null)
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
  const selRef = mongoResource(sel, sel?.resource ?? null)
  const tabRef = mongoResource(tab, resourceFromLegacyTab(tab))
  const needed = DEPTH[requiredLevel] ?? DEPTH.connection

  if (depth(selRef) >= needed) return nodeFrom(sel, selRef)
  if (depth(tabRef) >= needed) return nodeFrom(tab, tabRef)
  // Neither is deep enough: hand back the shallower of the two anyway, so the caller
  // can name what is selected in its guide message.
  return nodeFrom(sel, selRef) || nodeFrom(tab, tabRef)
}

// The PostgreSQL sibling of resolveMenuTarget (ozendb-sxd), with the same precedence:
// the sidebar selection wins when it is deep enough for the action, the active tab is
// the fallback, and `null` means neither can name a PostgreSQL target.
// `requiredLevel` is 'schema' | 'table' | null.
//
// Carries both the short alias PG_MENUS/PG_ACTIONS use (connId/connName) and the
// long alias collection/table-tab targets use (connectionId/connectionName) —
// the modals this feeds are a mix of both conventions (see CLAUDE.md's resource-
// identity note on the two flat shapes still being live), and duplicating two
// fields here is simpler than a per-call-site remap.
export function resolvePgMenuTarget(activeTab, treeSelection = null, requiredLevel = null) {
  const sel = treeSelection || null
  const tab = activeTab || null
  const needed = PG_DEPTH[requiredLevel] ?? PG_DEPTH.schema

  if (depth(pgResource(sel, sel?.resource ?? null)) >= needed) return pgTarget(sel)
  if (PG_TAB_TYPES.includes(tab?.type)) return pgTarget(tab)
  return null
}

// Both PostgreSQL sources already spell their levels the same way (database/schema/
// table), on a tab and on a tree selection alike, so one projection serves both.
function pgTarget(source) {
  return {
    connId: source.connectionId,
    connName: source.connectionName,
    connectionId: source.connectionId,
    connectionName: source.connectionName,
    database: source.database,
    schema: source.schema ?? null,
    table: source.table ?? null,
  }
}
