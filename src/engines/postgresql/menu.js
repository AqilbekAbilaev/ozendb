// PostgreSQL's switches for the native menu (menu.rs's PostgreSQL gates, #145), merged
// into the shared context by deriveMenuContext (utils/menuContext.js), and the node its
// items act on.
import { segmentName } from '../../utils/resourceRef.js'

// PostgreSQL's own levels, one deeper than MongoDB's: database/schema/table.
const PG_DEPTH = { schema: 2, table: 3 }

const PG_TAB_TYPES = ['postgresql.query', 'postgresql.table_browse', 'postgresql.search']

// Only a PostgreSQL selection counts toward the PostgreSQL gates. Depth alone cannot
// separate the engines — a MongoDB collection is two segments deep, exactly as a
// PostgreSQL schema is.
function pgResource(source, ref) {
  return source?.engine === 'postgresql' ? ref : null
}

// -1 for "names no resource", so every comparison against a depth is false for it.
function depth(ref) {
  return ref ? ref.segments.length : -1
}

function selectionReaches(treeSelection, level) {
  return depth(pgResource(treeSelection, treeSelection?.resource)) >= PG_DEPTH[level]
}

export const postgresqlMenu = Object.freeze({
  // The same union as MongoDB's: a query tab names a schema, a table tab names a schema
  // and a table, and the sidebar contributes whichever level its clicked row named.
  switches: ({ activeTab, treeSelection }) => ({
    hasPgSchema: PG_TAB_TYPES.includes(activeTab?.type) || selectionReaches(treeSelection, 'schema'),
    hasPgTable: activeTab?.type === 'postgresql.table_browse' || selectionReaches(treeSelection, 'table'),
  }),
  // No PostgreSQL item enables above a schema.
  selectionEnables: (treeSelection) => selectionReaches(treeSelection, 'schema'),
})

// The node a PostgreSQL menu item or toolbar button acts on (#145), with the same
// precedence as MongoDB's resolveMenuTarget: the sidebar selection wins when it is deep
// enough for the action, the active tab is the fallback, and `null` means neither can
// name a PostgreSQL target. `requiredLevel` is 'schema' | 'table' | null.
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
