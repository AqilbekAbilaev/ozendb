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

// The foreign keys with the table on either side, as `{ fromSchema, fromTable,
// fromColumns, toSchema, toTable, toColumns }`, each schema the database a table is in and
// the columns pairwise in the key's order.
export function listForeignKeys({ connectionId, database, table }) {
  return invoke('list_mysql_foreign_keys', { id: connectionId, database, table })
}

// A database's procedures and functions, triggers and events, as `{ routines, triggers,
// events }`: only those the login may see.
export function listStoredPrograms({ connectionId, database }) {
  return invoke('list_mysql_stored_programs', { id: connectionId, database })
}

// The statement that creates a view, procedure, function, trigger or event, as `kind`
// names it. Rejected, saying so, when MySQL hides a routine's body from the login.
export function showDefinition({ connectionId, database }, kind, name) {
  return invoke('show_mysql_definition', { id: connectionId, database, kind, name })
}
