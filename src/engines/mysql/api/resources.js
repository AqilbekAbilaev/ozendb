// MySQL catalog browsing. A connection reaches every database on its server, so each
// target names its database.

import { invoke } from '@tauri-apps/api/core'

// The databases the login may see, each flagged `system` when it is MySQL's own.
export function listDatabases(connectionId) {
  return invoke('list_mysql_databases', { id: connectionId })
}

export function listTables({ connectionId, database }) {
  return invoke('list_mysql_tables', { id: connectionId, database })
}

export function listColumns({ connectionId, database, table }) {
  return invoke('list_mysql_columns', { id: connectionId, database, table })
}
