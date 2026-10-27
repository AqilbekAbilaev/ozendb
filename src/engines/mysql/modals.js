import { defineAsyncComponent as lazy } from 'vue'

// MySQL's rows in the modal registry (constants/modalRegistry.js), in the same
// { component, level } shape as the app's own; engines/modals.js hands them to it.
export const MYSQL_MODALS = {
  // A MySQL view's or stored program's CREATE statement, opened from its sidebar row.
  mysqlDefinition: { component: lazy(() => import('./admin/MySqlDefinitionModal.vue')), level: 'database' },
  // MySQL's server tools, opened from its connection's right-click menu. Accounts are
  // server-wide, so Users is connection level.
  mysqlUsers:      { component: lazy(() => import('./admin/MySqlUsersModal.vue')),      level: 'connection' },
  // Opened from the Users modal's detail panel, not a sidebar node.
  mysqlGrants:     { component: lazy(() => import('./admin/MySqlGrantsModal.vue')),     level: 'connection' },
  mysqlActivity:   { component: lazy(() => import('./admin/MySqlActivityModal.vue')),   level: 'connection' },
  mysqlServerInfo: { component: lazy(() => import('./admin/MySqlServerInfoModal.vue')), level: 'connection' },
}
