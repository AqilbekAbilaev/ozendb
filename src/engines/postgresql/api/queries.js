// Running SQL and reading/editing table rows. Results come back as
// `{ columns, rows, truncated, elapsedMs }`, each row an array aligned to `columns`.

import { invoke } from '@tauri-apps/api/core'

export function runQuery(connectionId, sql) {
  return invoke('run_pg_query', { id: connectionId, sql })
}

// `filters` are `{ column, op, value }`; every one must hold.
export function browseTable({ connectionId, schema, table }, { filters = [], orderBy = null, descending = false, limit, offset }) {
  return invoke('browse_pg_table', { id: connectionId, schema, table, filters, orderBy, descending, limit, offset })
}

export function countTable({ connectionId, schema, table }, filters = []) {
  return invoke('count_pg_table', { id: connectionId, schema, table, filters })
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
