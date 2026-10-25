// How the MySQL activity monitor reads and filters the process list. Pure, so the
// filters and the time arithmetic are pinned by a spec.

export function queryText(process) {
  return process.query || '—'
}

// MySQL reports how long a connection has been in its state as whole seconds.
export function fmtSeconds(seconds) {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// The filter dropdowns offer what is on the server right now.
const present = (processes, field) => [...new Set(processes.map(p => p[field]).filter(Boolean))].sort()

export function processOptions(processes) {
  return {
    users: present(processes, 'user'),
    databases: present(processes, 'database'),
    commands: present(processes, 'command'),
  }
}

export function matchProcesses(processes, { user, database, command, activeOnly }) {
  return processes.filter(p =>
    (!user || p.user === user)
    && (!database || p.database === database)
    && (!command || p.command === command)
    && (!activeOnly || !p.idle))
}
