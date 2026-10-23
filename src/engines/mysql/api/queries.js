// Reading a table's rows. Results come back as `{ columns, rows, truncated, elapsedMs }`,
// each row an array aligned to `columns`.

import { invoke } from '@tauri-apps/api/core'

// `filters` are `{ column, op, value }`, all of which must hold; `orderBy` is
// `{ column }` or null, which orders by the primary key.
export function browseTable({ connectionId, database, table }, { filters = [], orderBy = null, descending = false, limit, offset }) {
  return invoke('browse_mysql_table', {
    id: connectionId, database, table, filters, orderBy: orderBy?.column ?? null, descending, limit, offset,
  })
}

export function countTable({ connectionId, database, table }, filters = []) {
  return invoke('count_mysql_table', { id: connectionId, database, table, filters })
}
