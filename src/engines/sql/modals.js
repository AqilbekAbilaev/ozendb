import { defineAsyncComponent as lazy } from 'vue'

// The dialogs every SQL engine shares, as rows in the modal registry
// (constants/modalRegistry.js) in the same { component, level } shape as the app's own;
// engines/modals.js hands them to it.
export const SQL_MODALS = {
  // Every SQL engine's row-edit history, reaching the engine through the target's
  // `engine`. Opened from a table tab's toolbar (and PostgreSQL's menu bar), not a sidebar node.
  sqlRowHistory:  { component: lazy(() => import('./admin/SqlRowHistoryModal.vue')), level: 'table' },
  // Every SQL engine's bulk export and CSV import, reaching the engine through the
  // target's `engine`: a table node, or a SQL editor's { connId, engine, database, query }.
  sqlExport:      { component: lazy(() => import('./admin/SqlExportModal.vue')),     level: 'database' },
  sqlImport:      { component: lazy(() => import('./admin/SqlImportModal.vue')),     level: 'database' },
}
