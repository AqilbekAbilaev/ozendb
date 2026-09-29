// What the PostgreSQL Server Info modal shows, worked out from what the server
// reported. Pure, so the arithmetic (and the "what counts as a match" rule) is
// pinned by a spec rather than by reading a modal.
import { fmtBytes, fmtNum } from '../../../utils/format'

const MINUTE = 60_000

// The server reports when it started; how long ago that was depends on the clock of
// whoever is looking, so it is worked out here rather than on the server. `now` is a
// parameter so the spec doesn't have to freeze time.
export function fmtUptime(startedAt, now = new Date()) {
  if (!startedAt) return '—'
  // Postgres writes "2026-09-29 08:00:00+00": Date reads neither the space nor a
  // two-digit offset, so both are brought up to ISO before parsing.
  const iso = String(startedAt).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  const started = new Date(iso)
  if (Number.isNaN(started.getTime())) return '—'
  const minutes = Math.floor((now - started) / MINUTE)
  // A negative reading means the two clocks disagree, which is worth saying nothing
  // about rather than reporting a server that starts in the future.
  if (minutes < 0) return '—'
  if (minutes < 1) return 'less than a minute'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  return [days && `${days}d`, (days || hours) && `${hours}h`, `${mins}m`].filter(Boolean).join(' ')
}

export function summaryCards(info, now = new Date()) {
  if (!info) return []
  return [
    { label: 'Version',       value: info.serverVersion || '—',            icon: 'info' },
    { label: 'Uptime',        value: fmtUptime(info.startedAt, now),       icon: 'clock' },
    { label: 'Database',      value: info.database || '—',                 icon: 'dbSmall' },
    { label: 'Database Size', value: fmtBytes(info.databaseSizeBytes),     icon: 'count' },
    { label: 'Connections',   value: `${fmtNum(info.connections)} of ${fmtNum(info.maxConnections)}`, icon: 'connect' },
    { label: 'Extensions',    value: fmtNum((info.extensions ?? []).length), icon: 'folder' },
  ]
}

// A setting is findable by what it is called, what it is set to, or what it does —
// searching only names means knowing the name already, which is the thing a settings
// viewer exists to avoid.
export function matchSettings(settings, search) {
  const term = (search ?? '').trim().toLowerCase()
  if (!term) return settings
  return settings.filter(s =>
    s.name.toLowerCase().includes(term)
    || String(s.setting ?? '').toLowerCase().includes(term)
    || (s.shortDesc ?? '').toLowerCase().includes(term))
}
