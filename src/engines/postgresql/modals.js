import { defineAsyncComponent as lazy } from 'vue'

// PostgreSQL's rows in the modal registry (constants/modalRegistry.js), in the same
// { component, level } shape as the app's own; engines/modals.js hands them to it.
export const PG_MODALS = {
  // PostgreSQL's own read-only diagnostics; opened from its tree menu with the node
  // itself as the target, so it takes no seeding of its own.
  pgServerInfo: { component: lazy(() => import('./admin/PostgresServerInfoModal.vue')), level: 'connection' },
  // Opened from a database node (every user schema) or a schema node (just that one).
  pgRoutines:   { component: lazy(() => import('./admin/PostgresRoutinesModal.vue')),   level: 'database' },
  pgActivity:   { component: lazy(() => import('./admin/PostgresActivityModal.vue')),   level: 'connection' },
  // Roles are cluster-wide in Postgres, so this is connection level, not database.
  pgRoles:      { component: lazy(() => import('./admin/PostgresRolesModal.vue')),      level: 'connection' },
  // Opened from the Roles modal's own detail panel, not a sidebar node.
  pgGrants:     { component: lazy(() => import('./admin/PostgresGrantsModal.vue')),      level: 'connection' },
  // Schema changes, opened from a database, schema or table node with the node as target.
  pgCreateSchema: { component: lazy(() => import('./admin/PostgresCreateSchemaModal.vue')), level: 'database' },
  pgCreateTable:  { component: lazy(() => import('./admin/PostgresCreateTableModal.vue')),  level: 'database' },
  pgDrop:         { component: lazy(() => import('./admin/PostgresDropModal.vue')),         level: 'database' },
  pgRenameTable:  { component: lazy(() => import('./admin/PostgresRenameTableModal.vue')),  level: 'database' },
}
