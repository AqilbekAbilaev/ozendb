// PostgreSQL bulk transfer (ozendb-6v3). Export is a read, allowed on a read-only
// connection, and always runs in a read-only transaction.

import { invoke } from '@tauri-apps/api/core'

// `source` is { schema, table } or { query }; `format` 'csv' or 'json'. Resolves to
// { rows, bytes }, where rows is null for CSV.
export function exportData({ connectionId, database = null }, source, format, path) {
  return invoke('export_pg_data', { id: connectionId, database, source, format, path })
}
