// A PostgreSQL table tab's lasting state: what the user built, as JSON-only data a
// session saves (and sync will later share). Nothing derived or fetched lives here —
// column info, SQL text and rows are worked out from it. See
// .local-docs/postgresql-tab-objects.md.
import { createSqlRun } from './runSql.js'

export const TABLE_STATE_VERSION = 1

export function createTableState({ limit } = {}) {
  return {
    v: TABLE_STATE_VERSION,
    query: {
      filterText: {},
      filters: [],
      joins: [],
      nextJoin: 1,
      shownColumns: [],
      orderBy: null,
      descending: false,
      limit: limit ?? 100,
      offset: 0,
    },
    mode: 'filter',
    sql: '',
    paused: { conditions: {}, columns: null, sort: null },
  }
}

// This device's view of the tab: saved with it, never shared.
export function createTableUi() {
  return { builderOpen: false, builderWidth: 360, rtab: 'Result' }
}

// What a session writes for the tab: a copy, for now without the page and the paused
// parts — bringing those back after a restart is a change of its own (ozendb-3sb.2).
export function stateToSave(state) {
  const saved = JSON.parse(JSON.stringify(state))
  saved.query.offset = 0
  saved.paused = createTableState().paused
  return saved
}

// What the tab works out and fetches as it's used: rebuilt fresh, never saved.
// `generation` counts loads, so only the latest may write back; 0 means never loaded.
export function createTableRuntime(connectionId) {
  return {
    mainColumns: null, joinColumns: {}, foreignKeys: {}, server: null,
    columns: [], rows: [], total: null, elapsedMs: null,
    loading: false, error: null, editError: null, filterRefusal: null, messages: [],
    generation: 0, builtSql: null,
    sqlRun: createSqlRun(connectionId), explainRun: createSqlRun(connectionId),
  }
}

// A join as saved: before joins matched on several columns it held one `column` /
// `equals` pair, and every saved join carried its table's column list, which is
// catalog data fetched again on load.
function savedJoin({ key, schema, table, kind, on, column, equals }) {
  return { key, schema, table, kind, on: on ?? [{ column, equals }] }
}

// The first shape saved: the table tab's settings as `view`.
function fromView(view) {
  const state = createTableState({ limit: view.limit })
  const joins = (view.joins ?? []).map(savedJoin)
  state.query = {
    ...state.query,
    filterText: view.filterText ?? {},
    filters: view.filters ?? [],
    joins,
    nextJoin: Math.max(0, ...joins.map(j => Number(j.key.slice(1)))) + 1,
    shownColumns: view.shownColumns ?? [],
    orderBy: view.orderBy ?? null,
    descending: view.descending ?? false,
  }
  state.mode = view.mode ?? 'filter'
  state.sql = view.sql ?? ''
  return state
}

// Whatever a session holds for a table tab, as the current state. A state from a newer
// version of the app can't be read safely, so the tab starts fresh instead.
export function migrateTableState(saved = {}) {
  if (saved.state) return saved.state.v === TABLE_STATE_VERSION ? saved.state : createTableState()
  return fromView(saved.view ?? {})
}
