// PostgreSQL's switches for the native menu (menu.rs's PostgreSQL gates, #145), merged
// into the shared context by deriveMenuContext (utils/menuContext.js).
import { PG_DEPTH, PG_TAB_TYPES, depth, pgResource } from '../../utils/menuContext.js'

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
