import { defineAsyncComponent } from 'vue'
import { ENGINE_MODALS } from '../engines/modals.js'

// Single source of truth for registry-driven modals. One row per modal:
//   component — the modal, lazy-loaded so each is code-split out of the main bundle
//   level     — node depth the modal needs; drives feature gating/seeding (see useFeatures)
//
// A conforming modal takes a single `target` prop (its context object) and emits `close`.
// AppModals.vue renders whatever stores/modals.js reports open via one v-for, so adding a
// modal is one row (here, or in its engine's modals.js) plus the component itself — no edits to useFeatures/AppModals.
// (Modals that emit extra events or carry no context still live as explicit blocks in
// AppModals until the registry grows an adapter for them.)
const lazy = (loader) => defineAsyncComponent(loader)

const APP_MODALS = {
  // ── app-level singletons (no node target; level null) ──
  // Opened by id alone (openModal('about')); any session props/events are supplied by
  // the owner when it opens the modal and bound generically by AppModals.
  connectionManager: { component: lazy(() => import('../components/connection/ConnectionManager.vue')), level: null },
  about:             { component: lazy(() => import('../components/app/AboutModal.vue')),                level: null },
  preferences:       { component: lazy(() => import('../components/app/PreferencesModal.vue')),          level: null },
  update:            { component: lazy(() => import('../components/app/UpdateModal.vue')),               level: null },
  errorReport:       { component: lazy(() => import('../components/app/ErrorReportModal.vue')),          level: null },
}

// The app's own rows and each engine's (engines/<engine>/modals.js, gathered by
// engines/modals.js). Ids are global, since openModal names a dialog by id alone; the
// registry's spec checks that no two tables share one.
export const MODAL_TABLES = [APP_MODALS, ...ENGINE_MODALS]

export const MODALS = Object.assign({}, ...MODAL_TABLES)
