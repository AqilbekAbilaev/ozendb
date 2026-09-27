// Running SQL and reading/editing table rows. Results come back as
// `{ columns, rows, truncated, elapsedMs }`, each row an array aligned to `columns`.

import { invoke } from '@tauri-apps/api/core'

// `runId` names the run so cancelQuery can stop it while it's in flight; `txId` runs it
// in a transaction held open by beginTransaction.
export function runQuery(connectionId, sql, runId = null, txId = null) {
  return invoke('run_pg_query', { id: connectionId, sql, runId, txId })
}

// Manual mode: a transaction held open on its own connection, under an id the caller
// picks, until committed or rolled back.
export function beginTransaction(connectionId, txId) {
  return invoke('begin_pg_transaction', { id: connectionId, txId })
}

export function commitTransaction(txId) {
  return invoke('commit_pg_transaction', { txId })
}

export function rollbackTransaction(txId) {
  return invoke('rollback_pg_transaction', { txId })
}

// The plan PostgreSQL chose, with real timings: EXPLAIN (ANALYZE, FORMAT JSON)'s array,
// run in a transaction that's rolled back.
export function explainQuery(connectionId, sql) {
  return invoke('explain_pg_query', { id: connectionId, sql })
}

// The SQL laid out one clause per line; refused (with why) for SQL it can't read or
// that has comments, which formatting would drop.
export function formatQuery(sql) {
  return invoke('format_pg_sql', { sql })
}

export function cancelQuery(connectionId, runId) {
  return invoke('cancel_pg_query', { id: connectionId, runId })
}

// A column is named by `table` — 0 for the browsed table, 1 and on for `joins` in
// order — and its name. `filters` are `{ table, column, op, value }`, all of which
// must hold; `joins` are `{ schema, table, kind: 'left'|'inner', column, equals:
// { table, column } }`; `orderBy` is `{ table, column }` or null.
export function browseTable({ connectionId, schema, table }, { joins = [], filters = [], orderBy = null, descending = false, limit, offset }) {
  return invoke('browse_pg_table', {
    id: connectionId, schema, table, joins, filters,
    orderBy: orderBy?.column ?? null, orderTable: orderBy?.table ?? 0,
    descending, limit, offset,
  })
}

export function countTable({ connectionId, schema, table }, filters = [], joins = []) {
  return invoke('count_pg_table', { id: connectionId, schema, table, joins, filters })
}

// `where` holds the row's primary-key columns and their original values.
export function updateRow({ connectionId, schema, table }, set, where) {
  return invoke('update_pg_row', { id: connectionId, schema, table, set, where })
}

// A table tab's SQL as `{ filters, orderBy, descending, limit, offset }`; rejects,
// with the reason, SQL the filter boxes can't show.
export function readTableSelect({ schema, table }, sql) {
  return invoke('read_pg_table_select', { sql, schema, table })
}
