// Running SQL and reading/editing table rows. Results come back as
// `{ columns, rows, truncated, elapsedMs }`, each row an array aligned to `columns`.

import { invoke } from '@tauri-apps/api/core'

export function runQuery(connectionId, sql) {
  return invoke('run_pg_query', { id: connectionId, sql })
}

export function browseTable({ connectionId, schema, table }, { orderBy = null, descending = false, limit, offset }) {
  return invoke('browse_pg_table', { id: connectionId, schema, table, orderBy, descending, limit, offset })
}

export function countTable({ connectionId, schema, table }) {
  return invoke('count_pg_table', { id: connectionId, schema, table })
}

// `where` holds the row's primary-key columns and their original values.
export function updateRow({ connectionId, schema, table }, set, where) {
  return invoke('update_pg_row', { id: connectionId, schema, table, set, where })
}
