// PostgreSQL catalog browsing. A connection is bound to one database, so targets are
// `{ connectionId, schema, table }` — there is no database to name.

import { invoke } from '@tauri-apps/api/core'

export function listSchemas(connectionId) {
  return invoke('list_pg_schemas', { id: connectionId })
}

export function listTables({ connectionId, schema }) {
  return invoke('list_pg_tables', { id: connectionId, schema })
}

export function listColumns({ connectionId, schema, table }) {
  return invoke('list_pg_columns', { id: connectionId, schema, table })
}
