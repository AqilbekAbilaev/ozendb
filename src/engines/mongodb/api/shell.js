// Mongo shell API: IntelliShell sessions and per-connection command history.
// History commands key on the backend's `connection_id` (like the query library),
// not on the standard `id` payload key. `read_shell_script` / `write_shell_script`
// stay direct Tauri calls because they are generic file I/O.

import { invoke } from '@tauri-apps/api/core'

export function runShellCommand(session, code) {
  return invoke('run_shell_command', {
    id:        session.connectionId,
    database:  session.database,
    sessionId: session.sessionId,
    code,
  })
}

export function closeShellSession(sessionId) {
  return invoke('close_shell_session', { sessionId })
}

export function getShellHistory(connectionId) {
  return invoke('get_shell_history', { connectionId })
}

export function pushShellCommand(connectionId, command) {
  return invoke('push_shell_command', { connectionId, command })
}

export function clearShellHistory(connectionId) {
  return invoke('clear_shell_history', { connectionId })
}