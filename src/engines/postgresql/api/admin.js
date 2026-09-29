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
