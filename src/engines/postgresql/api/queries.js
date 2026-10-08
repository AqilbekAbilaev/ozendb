// Running SQL and reading/editing table rows. Results come back as
// `{ columns, rows, truncated, elapsedMs }`, each row an array aligned to `columns`.

import { invoke } from '@tauri-apps/api/core'

// `runId` names the run so cancelQuery can stop it while it's in flight; `txId` runs it
// in a transaction held open by beginTransaction. `database`, when given, targets a
// database other than the connection's own — opening a second database on the same
// server (#124).
export function runQuery(connectionId, sql, runId = null, txId = null, database = null) {
  return invoke('run_pg_query', { id: connectionId, sql, runId, txId, database })
}

// Manual mode: a transaction held open on its own connection, under an id the caller
// picks, until committed or rolled back. `database` as in `runQuery`.
export function beginTransaction(connectionId, txId, database = null) {
  return invoke('begin_pg_transaction', { id: connectionId, txId, database })
}

export function commitTransaction(txId) {
  return invoke('commit_pg_transaction', { txId })
}

export function rollbackTransaction(txId) {
  return invoke('rollback_pg_transaction', { txId })
}

// The plan PostgreSQL chose, with real timings: EXPLAIN (ANALYZE, FORMAT JSON)'s array,
// run in a transaction that's rolled back. `database` as in `runQuery`.
export function explainQuery(connectionId, sql, database = null) {
  return invoke('explain_pg_query', { id: connectionId, sql, database })
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

// `where` holds the row's primary-key columns and their original values. `before`
// holds `set`'s columns' own pre-edit values — the grid already has them loaded —
// so the backend can record an undo-able history entry (#129) without a
// second read. `txId` runs it in a transaction held open by beginTransaction, the
// same as runQuery.
export function updateRow({ connectionId, database, schema, table }, set, before, where, txId = null) {
  return invoke('update_pg_row', { id: connectionId, database, schema, table, set, before, where, txId })
}

// `rows` holds one entry per row to delete, each its primary-key columns and their
// original values — the same shape `where` above takes, one per row. `txId` as above.
export function deleteRows({ connectionId, schema, table }, rows, txId = null) {
  return invoke('delete_pg_rows', { id: connectionId, schema, table, rows, txId })
}

// `values` holds one entry per column to set on the new row — an identity or stored
// generated column must never appear here. Resolves to how many rows were inserted
// (always 1); the caller re-reads the page to see the row as the server actually
// stored it. `txId` as above.
export function insertRow({ connectionId, schema, table }, values, txId = null) {
  return invoke('insert_pg_row', { id: connectionId, schema, table, values, txId })
}

// A table tab's SQL as `{ filters, orderBy, descending, limit, offset }`; rejects,
// with the reason, SQL the filter boxes can't show.
export function readTableSelect({ schema, table }, sql) {
  return invoke('read_pg_table_select', { sql, schema, table })
}

// Row-edit history (#129) — `updateRow`'s pre-images, newest first. Distinct
// from `library.js`'s `listHistory`: that is the SQL *statements* a connection ran,
// this is what *data* a table's rows actually changed to and from.
export function listRowHistory({ connectionId, database, schema, table }) {
  return invoke('list_pg_row_history', { id: connectionId, database, schema, table })
}

export function clearRowHistory({ connectionId, database, schema, table }) {
  return invoke('clear_pg_row_history', { id: connectionId, database, schema, table })
}

// Reverses one recorded edit; refused (as a conflict, not a silent overwrite) if the
// row has changed again since.
export function undoRowEdit(entryId) {
  return invoke('undo_pg_row_edit', { entryId })
}
