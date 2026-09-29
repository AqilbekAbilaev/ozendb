// A MongoDB collection tab's state, split the way a PostgreSQL table tab's already is
// (engines/postgresql/workspaces/tableState.js): `state` is what the user built, as
// JSON-only data a session saves; `ui` is this device's view of the tab; `runtime` is
// what it fetched, rebuilt fresh and never saved.
//
// The flat field names (tab.filter, tab.results, …) are what ~300 call sites still
// read, so `withFlatFields` keeps them working as accessors onto the nested state —
// one value under two names, rather than two copies that drift. They are
// non-enumerable, so serializing a tab writes the nested state alone, and the
// definition's `hydrate` hook re-establishes them after the lifecycle's deep clone.
// Migrating those call sites and deleting the accessors is the rest of this work.

export const COLLECTION_STATE_VERSION = 1

export function createCollectionState({ queryLimit } = {}) {
  return {
    v: COLLECTION_STATE_VERSION,
    query: {
      filter: '',
      projection: '',
      sort: '',
      skip: 0,
      limit: queryLimit ?? 50,
      pipeline: '',
      // The Visual Query Builder's conditions, and the order columns were dragged
      // into: built by hand, so they belong with the query rather than the view.
      vqb: null,
      colOrder: null,
    },
  }
}

// This device's view of the tab: saved with it, never shared.
export function createCollectionUi({ resultView } = {}) {
  return { resultView: resultView ?? 'table' }
}

// What the tab ran and got back: never saved, and never shared between two tabs —
// replaying state onto a shared runtime is how two tabs end up showing one set of
// results.
export function createCollectionRuntime() {
  return {
    results: [], hasRun: false, isRunning: false, runError: null,
    selectedRow: -1, selectedRows: [], elapsedMs: null,
  }
}

// The flat shape sessions have been written in until now: the query fields sat at the
// top level of the saved record.
function fromFlat(saved) {
  const state = createCollectionState({ queryLimit: saved.limit })
  state.query = {
    ...state.query,
    filter: saved.filter ?? '',
    projection: saved.projection ?? '',
    sort: saved.sort ?? '',
    skip: saved.skip ?? 0,
    limit: saved.limit ?? 50,
    pipeline: saved.pipeline ?? '',
    vqb: saved.vqb ?? null,
    colOrder: saved.colOrder ?? null,
  }
  return state
}

// Whatever a session holds for a collection tab, as the current state. A state from a
// newer version of the app can't be read safely, so the tab starts fresh instead.
export function migrateCollectionState(saved = {}) {
  if (saved && saved.state) {
    return saved.state.v === COLLECTION_STATE_VERSION ? saved.state : createCollectionState()
  }
  return fromFlat(saved ?? {})
}

const QUERY_FIELDS = ['filter', 'projection', 'sort', 'skip', 'limit', 'pipeline', 'vqb', 'colOrder']
const RUNTIME_FIELDS = ['results', 'hasRun', 'isRunning', 'runError', 'selectedRow', 'selectedRows', 'elapsedMs']
const UI_FIELDS = ['resultView']

// `holder` returns the object the value actually lives on, so a nested path
// (state.query) is as ordinary as a top-level one (runtime).
function define(tab, name, holder, key) {
  Object.defineProperty(tab, name, {
    get() { return holder(this)[key] },
    set(value) { holder(this)[key] = value },
    // Enumerable, so `Object.keys(tab)` and `{ ...tab }` see exactly what they saw
    // before the split — 26 files still do both. What a session writes is chosen by
    // the definition's `serialize`, not by enumerability, so nothing duplicates on
    // disk. Non-enumerable would be tidier and would silently change spread results.
    enumerable: true,
    configurable: true,
  })
}

export function withFlatFields(tab) {
  // A tab that has been through the lifecycle's clone still has its data but not its
  // accessors; one built fresh has neither. Both arrive here, so this must be safe to
  // apply twice — `configurable: true` is what makes that so.
  if (!tab.state) return tab
  for (const name of QUERY_FIELDS) define(tab, name, t => t.state.query, name)
  for (const name of RUNTIME_FIELDS) define(tab, name, t => t.runtime, name)
  for (const name of UI_FIELDS) define(tab, name, t => t.ui, name)
  return tab
}
