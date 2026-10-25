// MySQL server administration. An account is a user at a host, `{ user, host }`.

import { invoke } from '@tauri-apps/api/core'

export function users(connectionId) {
  return invoke('list_mysql_users', { id: connectionId })
}

// `user` is `{ user, host, password }`, the password null for none.
export function createUser(connectionId, user) {
  return invoke('create_mysql_user', { id: connectionId, user })
}

export function dropUser(connectionId, { user, host }) {
  return invoke('drop_mysql_user', { id: connectionId, user, host })
}

// The GRANT statements SHOW GRANTS gives for the account, its roles among them.
export function grants(connectionId, { user, host }) {
  return invoke('list_mysql_grants', { id: connectionId, user, host })
}

// `change` is what grantRows.js's privilegeChange builds. Both are refused on a
// read-only connection.
export function grantPrivileges(connectionId, change) {
  return invoke('grant_mysql_privileges', { id: connectionId, change })
}

export function revokePrivileges(connectionId, change) {
  return invoke('revoke_mysql_privileges', { id: connectionId, change })
}

// Every connection this login may see: all of them only with the PROCESS privilege.
export function processes(connectionId) {
  return invoke('list_mysql_processes', { id: connectionId })
}

// Stop a connection's current statement; the connection stays open. Both kills answer
// false for a connection that has already gone.
export function killQuery(connectionId, process) {
  return invoke('kill_mysql_query', { id: connectionId, process })
}

// Close a connection, rolling back whatever transaction it holds.
export function killConnection(connectionId, process) {
  return invoke('kill_mysql_connection', { id: connectionId, process })
}

// Every global variable and status counter, as `{ variables, status }` of `{ name, value }`.
export function serverInfo(connectionId) {
  return invoke('show_mysql_server_info', { id: connectionId })
}
