// PostgreSQL bulk transfer (ozendb-6v3). Export is a read, allowed on a read-only
// connection, and always runs in a read-only transaction.

import { invoke } from '@tauri-apps/api/core'

// `source` is { schema, table } or { query }; `format` 'csv' or 'json'. Resolves to
// { rows, bytes }, where rows is null for CSV.
export function exportData({ connectionId, database = null }, source, format, path) {
  return invoke('export_pg_data', { id: connectionId, database, source, format, path })
}

// The file's header and first rows beside the table's columns, with a guessed mapping.
export function importPreview({ connectionId, database = null, schema, table }, path) {
  return invoke('pg_import_preview', { id: connectionId, database, schema, table, path })
}

// `mapping` is one target column (or null) per CSV header. All or nothing; refused on a
// read-only connection. Resolves to the number of rows imported.
export function importCsv({ connectionId, database = null, schema, table }, path, mapping) {
  return invoke('import_pg_csv', { id: connectionId, database, schema, table, path, mapping })
}
