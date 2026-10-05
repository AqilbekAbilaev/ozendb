// A MongoDB collection tab's state, split the way a PostgreSQL table tab's already is
// (engines/postgresql/workspaces/tableState.js): `state` is what the user built, as
// JSON-only data a session saves; `ui` is this device's view of the tab; `runtime` is
// what it fetched, rebuilt fresh and never saved.

import { createSelection } from '../../../composables/useRowSelection'

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
    results: [], hasRun: false, isRunning: false, runError: null, runErrorCode: null, elapsedMs: null,
    // The run in flight: its server-side tag, the wall clock it started at (for the live
    // counter), and whether the user cancelled it.
    runId: null, startedAt: null, cancelled: false,
    // The footer's optional count, and the filter it was counted for.
    total: null, totalFilter: null, isCounting: false, countShown: false,
    ...createSelection(),
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
