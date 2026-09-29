// PostgreSQL server administration reads. Everything here is diagnostics: it reports
// what the server is set to, and never sets anything.

import { invoke } from '@tauri-apps/api/core'

// Version, uptime, current database size, connection count and installed extensions.
export function serverInfo(connectionId) {
  return invoke('pg_server_info', { id: connectionId })
}

// Every `pg_settings` row this role may see, with its source and restart flag.
export function serverSettings(connectionId) {
  return invoke('pg_server_settings', { id: connectionId })
}

// Every function and procedure in one schema, or in all the user schemas when the
// schema is omitted. Aggregates and window functions are left out (see routines.rs).
export function routines(connectionId, schema = null) {
  return invoke('pg_routines', { id: connectionId, schema })
}

// One routine's CREATE statement, keyed by oid because names overload.
export function routineSource(connectionId, oid) {
  return invoke('pg_routine_source', { id: connectionId, oid })
}
