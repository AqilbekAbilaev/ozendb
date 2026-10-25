// MySQL bulk transfer (#396). Export is a read, allowed on a read-only connection, and
// always runs in a read-only transaction.

import { invoke } from '@tauri-apps/api/core'

// `source` is { schema, table }, `schema` naming the table's database, or { query };
// `database`, when given, is the one a query's session starts in. Resolves to
// { rows, bytes }.
export function exportData({ connectionId, database = null }, source, format, path) {
  return invoke('export_mysql_data', { id: connectionId, database, source, format, path })
}

// The file's header and first rows beside the table's columns, with a guessed mapping.
export function importPreview({ connectionId, database, table }, path) {
  return invoke('mysql_import_preview_csv', { id: connectionId, database, table, path })
}

// `mapping` is one target column (or null) per CSV header. All or nothing; refused on a
// read-only connection. Resolves to the number of rows imported.
export function importCsv({ connectionId, database, table }, path, mapping) {
  return invoke('import_mysql_csv', { id: connectionId, database, table, path, mapping })
}
