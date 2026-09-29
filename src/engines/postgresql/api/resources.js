// PostgreSQL catalog browsing. A connection is bound to one database, so targets are
// `{ connectionId, schema, table }` — there is no database to name.

import { invoke } from '@tauri-apps/api/core'

// Every non-template database on the server, each with its on-disk size (null where
// the role may not connect). A connection browses only its own database for now, so
// this is read for that one entry's size.
export function listDatabases(connectionId) {
  return invoke('list_pg_databases', { id: connectionId })
}

export function listSchemas(connectionId) {
  return invoke('list_pg_schemas', { id: connectionId })
}

export function listTables({ connectionId, schema }) {
  return invoke('list_pg_tables', { id: connectionId, schema })
}

export function listColumns({ connectionId, schema, table }) {
  return invoke('list_pg_columns', { id: connectionId, schema, table })
}

// Single-column foreign keys with the table on either side, as
// `{ fromSchema, fromTable, fromColumn, toSchema, toTable, toColumn }`.
export function listForeignKeys({ connectionId, schema, table }) {
  return invoke('list_pg_foreign_keys', { id: connectionId, schema, table })
}

// On-disk size, bloat signals and per-index usage for one table.
export function tableStats({ connectionId, schema, table }) {
  return invoke('pg_table_stats', { id: connectionId, schema, table })
}
