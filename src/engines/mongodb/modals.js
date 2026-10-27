import { defineAsyncComponent as lazy } from 'vue'

// MongoDB's rows in the modal registry (constants/modalRegistry.js), in the same
// { component, level } shape as the app's own; engines/modals.js hands them to it.
export const MONGO_MODALS = {
  // ── connection level ──
  serverStatus: { component: lazy(() => import('./admin/ServerStatusModal.vue')), level: 'connection' },
  serverCharts: { component: lazy(() => import('./admin/ServerChartsModal.vue')), level: 'connection' },
  // Build / Host / Replica info share one modal; its feature seeds a { kind, title } payload
  // on top of the node fields (see openServerInfo), so it opens directly, not via modalFeature.
  serverInfo:   { component: lazy(() => import('./admin/ServerInfoModal.vue')),   level: 'connection' },
  addDatabase:  { component: lazy(() => import('./admin/AddDatabaseModal.vue')),  level: 'connection' },

  // ── database level ──
  dbStats:   { component: lazy(() => import('./admin/DatabaseStatsModal.vue')), level: 'database' },
  profiler:  { component: lazy(() => import('./admin/ProfilerModal.vue')),      level: 'database' },
  users:     { component: lazy(() => import('./admin/UsersModal.vue')),         level: 'database' },
  roles:     { component: lazy(() => import('./admin/RolesModal.vue')),         level: 'database' },
  functions: { component: lazy(() => import('./admin/FunctionsModal.vue')),     level: 'database' },
  gridfs:    { component: lazy(() => import('./tools/GridFsModal.vue')),        level: 'database' },
  addBucket:     { component: lazy(() => import('./admin/AddBucketModal.vue')),     level: 'database' },
  addCollection: { component: lazy(() => import('./admin/AddCollectionModal.vue')), level: 'database' },
  dropDatabase:  { component: lazy(() => import('./admin/DropDatabaseModal.vue')),  level: 'database' },
  // Add View is seeded with an extra `source` on top of the database fields (empty from a
  // database node, the clicked collection from "Add View Here…"), so its features open it
  // directly rather than through modalFeature.
  addView:       { component: lazy(() => import('./admin/AddViewModal.vue')),       level: 'database' },

  // ── collection level ──
  // Registry modals take one `target` prop and emit `close`; their owners may supply
  // additional per-open listeners without adding routing to App.vue.
  stats:     { component: lazy(() => import('./admin/StatsModal.vue')),             level: 'collection' },
  history:   { component: lazy(() => import('./tools/CollectionHistoryModal.vue')), level: 'collection' },
  mapReduce: { component: lazy(() => import('./query/MapReduceModal.vue')),         level: 'collection' },
  validator: { component: lazy(() => import('./admin/ValidatorModal.vue')),         level: 'collection' },
  import:    { component: lazy(() => import('./tools/ImportFormatModal.vue')),      level: 'collection' },
  exportSource: { component: lazy(() => import('./tools/ExportSourceModal.vue')),   level: 'collection' },
  dropCollection:      { component: lazy(() => import('./admin/DropCollectionModal.vue')),      level: 'collection' },
  renameCollection:    { component: lazy(() => import('./admin/RenameCollectionModal.vue')),    level: 'collection' },
  duplicateCollection: { component: lazy(() => import('./admin/DuplicateCollectionModal.vue')), level: 'collection' },
}
