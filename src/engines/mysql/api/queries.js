// Running SQL and reading a table's rows. Results come back as
// `{ columns, rows, truncated, elapsedMs }`, each row an array aligned to `columns`.

import { invoke } from '@tauri-apps/api/core'

// A column is named by `table` — 0 for the browsed table, 1 and on for `joins` in
// order — and its name. `filters` are `{ table, column, op, value }`, all of which must
// hold; `joins` are `{ schema, table, kind: 'left'|'inner', on: [{ column, equals:
// { table, column } }] }`, `schema` naming the joined table's database; `orderBy` is
// `{ table, column }` or null, which orders by the primary key.
export function browseTable({ connectionId, database, table }, { joins = [], filters = [], orderBy = null, descending = false, limit, offset }) {
  return invoke('browse_mysql_table', {
    id: connectionId, database, table, joins, filters,
    orderBy: orderBy?.column ?? null, orderTable: orderBy?.table ?? 0,
    descending, limit, offset,
  })
}

export function countTable({ connectionId, database, table }, filters = [], joins = []) {
  return invoke('count_mysql_table', { id: connectionId, database, table, joins, filters })
}

// A table tab's SQL as `{ joins, columns, filters, orderBy, descending, limit, offset }`;
// rejects, with the reason, SQL the filter boxes can't show.
export function readTableSelect({ database, table }, sql) {
  return invoke('read_mysql_table_select', { sql, database, table })
}

// Saves a table tab's staged rows, `{ inserts, updates, deletes }`, in one transaction
// inside one command: any failure, or a row changed since it was loaded, saves none.
export function saveRows({ connectionId, database, table }, changes) {
  return invoke('save_mysql_rows', { id: connectionId, database, table, changes })
}

// Runs a script, its statements one after another. `runId` names the run so cancelQuery
// can stop it; `txId` runs it in a transaction held open by beginTransaction;
// `database`, when given, is the one the session starts in. Resolves to the last
// result, with every statement's in `statements`, a CALL's one per result set.
export async function runQuery(connectionId, sql, runId = null, txId = null, database = null) {
  const statements = await invoke('run_mysql_query', { id: connectionId, sql, runId, txId, database })
  return { ...statements.at(-1), statements }
}

export function cancelQuery(connectionId, runId) {
  return invoke('cancel_mysql_query', { id: connectionId, runId })
}

// Manual mode: a transaction held open on its own session, under an id the caller
// picks, until committed or rolled back. `database` as in `runQuery`.
export function beginTransaction(connectionId, txId, database = null) {
  return invoke('begin_mysql_transaction', { id: connectionId, txId, database })
}

export function commitTransaction(txId) {
  return invoke('commit_mysql_transaction', { txId })
}

export function rollbackTransaction(txId) {
  return invoke('rollback_mysql_transaction', { txId })
}

// The plan MySQL chose for one statement, as workspaces/planRows.js reads it: run with
// ANALYZE, adding real rows and times, when it only reads and the server is 8.0.18 or
// later. `runId` and `database` as in `runQuery`.
export function explainQuery(connectionId, sql, runId = null, database = null) {
  return invoke('explain_mysql_query', { id: connectionId, sql, runId, database })
}

// The SQL laid out one clause per line; refused (with why) for SQL it can't read, or
// that formatting would change.
export function formatQuery(sql) {
  return invoke('format_mysql_sql', { sql })
}
