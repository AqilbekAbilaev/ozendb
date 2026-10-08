// PostgreSQL server administration: diagnostics, sessions, roles and their grants.

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

// Every session on the server, as pg_stat_activity reports it.
export function sessions(connectionId) {
  return invoke('pg_sessions', { id: connectionId })
}

// Ask a backend to stop its current statement; the session survives.
export function cancelBackend(connectionId, pid) {
  return invoke('pg_cancel_backend', { id: connectionId, pid })
}

// Close a backend's whole session, rolling back whatever it was doing.
export function terminateBackend(connectionId, pid) {
  return invoke('pg_terminate_backend', { id: connectionId, pid })
}

// Every role on the server, with its attributes and the roles it belongs to.
export function roles(connectionId) {
  return invoke('pg_roles', { id: connectionId })
}

// Create a role. `role` is { name, password, canLogin, superuser, createDb, createRole }.
export function createRole(connectionId, role) {
  return invoke('create_pg_role', { id: connectionId, role })
}

export function dropRole(connectionId, name) {
  return invoke('drop_pg_role', { id: connectionId, name })
}

// Every schema/table/view/sequence this role holds a direct privilege on — not what it
// inherits through group membership (#141).
export function grants(connectionId, role) {
  return invoke('list_pg_grants', { id: connectionId, role })
}

// `change` is { role, objectKind, schema, object, privileges, grantOption?, cascade? };
// see grantRows.js, which builds it. Both are refused on a read-only connection.
export function grantPrivileges(connectionId, change) {
  return invoke('grant_pg_privileges', { id: connectionId, change })
}

export function revokePrivileges(connectionId, change) {
  return invoke('revoke_pg_privileges', { id: connectionId, change })
}
