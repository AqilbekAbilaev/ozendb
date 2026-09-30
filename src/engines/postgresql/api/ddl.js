// PostgreSQL schema changes from the sidebar. Every one is refused on a read-only
// connection, and gives up rather than waits when an open transaction holds the table.

import { invoke } from '@tauri-apps/api/core'

export function createSchema(connectionId, name) {
  return invoke('create_pg_schema', { id: connectionId, name })
}

export function dropSchema(connectionId, name, cascade) {
  return invoke('drop_pg_schema', { id: connectionId, name, cascade })
}

// `table` is { schema, name, columns: [{ name, dataType, nullable, primaryKey, identity }] }.
export function createTable(connectionId, table) {
  return invoke('create_pg_table', { id: connectionId, table })
}

export function dropTable({ connectionId, schema, table }, cascade) {
  return invoke('drop_pg_table', { id: connectionId, schema, table, cascade })
}

export function renameTable({ connectionId, schema, table }, newName) {
  return invoke('rename_pg_table', { id: connectionId, schema, table, newName })
}
