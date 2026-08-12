import { defineAsyncComponent } from 'vue'

// Single source of truth for registry-driven modals. One row per modal:
//   component — the modal, lazy-loaded so each is code-split out of the main bundle
//   level     — node depth the modal needs; drives feature gating/seeding (see useFeatures)
//
// A conforming modal takes a single `target` prop (its context object) and emits `close`.
// AppModals.vue renders whatever useModals reports open via one v-for, so adding a modal
// is this one row plus the component itself — no edits to useModals/useFeatures/AppModals.
// (Modals that emit extra events or carry no context still live as explicit blocks in
// AppModals until the registry grows an adapter for them.)
const lazy = (loader) => defineAsyncComponent(loader)

export const MODALS = {
  // ── app-level singletons (no node target; level null) ──
  // Opened by id alone (openModal('about')); any props/events they need are declared in
  // App.vue's modalProps / modalEmits maps and bound generically by AppModals.
  connectionManager: { component: lazy(() => import('../components/connection/ConnectionManager.vue')), level: null },
  about:             { component: lazy(() => import('../components/app/AboutModal.vue')),                level: null },
  preferences:       { component: lazy(() => import('../components/app/PreferencesModal.vue')),          level: null },
  update:            { component: lazy(() => import('../components/app/UpdateModal.vue')),               level: null },
  errorReport:       { component: lazy(() => import('../components/app/ErrorReportModal.vue')),          level: null },

  // ── connection level ──
  serverStatus: { component: lazy(() => import('../components/admin/ServerStatusModal.vue')), level: 'connection' },
  serverCharts: { component: lazy(() => import('../components/admin/ServerChartsModal.vue')), level: 'connection' },
  currentOps:   { component: lazy(() => import('../components/admin/CurrentOpsModal.vue')),   level: 'connection' },
  // Build / Host / Replica info share one modal; its feature seeds a { kind, title } payload
  // on top of the node fields (see openServerInfo), so it opens directly, not via modalFeature.
  serverInfo:   { component: lazy(() => import('../components/admin/ServerInfoModal.vue')),   level: 'connection' },
  addDatabase:  { component: lazy(() => import('../components/admin/AddDatabaseModal.vue')),  level: 'connection' },

  // ── database level ──
  dbStats:   { component: lazy(() => import('../components/admin/DatabaseStatsModal.vue')), level: 'database' },
  profiler:  { component: lazy(() => import('../components/admin/ProfilerModal.vue')),      level: 'database' },
  users:     { component: lazy(() => import('../components/admin/UsersModal.vue')),         level: 'database' },
  roles:     { component: lazy(() => import('../components/admin/RolesModal.vue')),         level: 'database' },
  functions: { component: lazy(() => import('../components/admin/FunctionsModal.vue')),     level: 'database' },
  gridfs:    { component: lazy(() => import('../components/tools/GridFsModal.vue')),        level: 'database' },
  // Structural dialogs: each owns its form state and its own driver call, and emits
  // `saved` so App.vue can refresh the sidebar (see its modalEmits map).
  addBucket:     { component: lazy(() => import('../components/admin/AddBucketModal.vue')),     level: 'database' },
  addCollection: { component: lazy(() => import('../components/admin/AddCollectionModal.vue')), level: 'database' },
  dropDatabase:  { component: lazy(() => import('../components/admin/DropDatabaseModal.vue')),  level: 'database' },
  // Add View is seeded with an extra `source` on top of the database fields (empty from a
  // database node, the clicked collection from "Add View Here…"), so its features open it
  // directly rather than through modalFeature.
  addView:       { component: lazy(() => import('../components/admin/AddViewModal.vue')),       level: 'database' },

  // ── collection level ──
  // A modal with extra domain events (e.g. validator's `saved`) keeps its component
  // conforming — one `target`, emits `close` — and declares those events in App.vue's
  // modalEmits map, which AppModals binds generically. The registry row stays pure data.
  stats:     { component: lazy(() => import('../components/admin/StatsModal.vue')),             level: 'collection' },
  history:   { component: lazy(() => import('../components/tools/CollectionHistoryModal.vue')), level: 'collection' },
  mapReduce: { component: lazy(() => import('../components/query/MapReduceModal.vue')),         level: 'collection' },
  validator: { component: lazy(() => import('../components/admin/ValidatorModal.vue')),         level: 'collection' },
  import:    { component: lazy(() => import('../components/tools/ImportFormatModal.vue')),      level: 'collection' },
  exportSource: { component: lazy(() => import('../components/tools/ExportSourceModal.vue')),   level: 'collection' },
  dropCollection:      { component: lazy(() => import('../components/admin/DropCollectionModal.vue')),      level: 'collection' },
  renameCollection:    { component: lazy(() => import('../components/admin/RenameCollectionModal.vue')),    level: 'collection' },
  duplicateCollection: { component: lazy(() => import('../components/admin/DuplicateCollectionModal.vue')), level: 'collection' },
}
