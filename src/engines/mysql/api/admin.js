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