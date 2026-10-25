// What the MySQL Server Info modal shows, picked out of the variables and status the
// server reported. Pure, so the arithmetic is pinned by a spec.
import { fmtNum } from '../../../utils/format'

const valueOf = (values, name) => values.find(v => v.name === name)?.value

// MySQL reports its uptime as whole seconds, in the status counter `Uptime`.
export function fmtUptime(seconds) {
  if (seconds == null) return '—'
  const minutes = Math.floor(Number(seconds) / 60)
  if (minutes < 1) return 'less than a minute'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  return [days && `${days}d`, (days || hours) && `${hours}h`, `${minutes % 60}m`].filter(Boolean).join(' ')
}

export function summaryCards(info) {
  if (!info) return []
  const variable = (name) => valueOf(info.variables, name)
  const status = (name) => valueOf(info.status, name)
  const count = (name) => (status(name) == null ? '—' : fmtNum(Number(status(name))))
  return [
    { label: 'Version',         value: variable('version') || '—',   icon: 'info' },
    { label: 'Uptime',          value: fmtUptime(status('Uptime')),  icon: 'clock' },
    { label: 'Connections',     value: `${count('Threads_connected')} of ${fmtNum(Number(variable('max_connections')))}`, icon: 'connect' },
    { label: 'Running threads', value: count('Threads_running'),     icon: 'run' },
    { label: 'Queries',         value: count('Questions'),           icon: 'count' },
    { label: 'Slow queries',    value: count('Slow_queries'),        icon: 'bolt' },
  ]
}

// Which build this is, in the server's own words: "MySQL Community Server - GPL".
export function serverBanner(info) {
  return info ? valueOf(info.variables, 'version_comment') : undefined
}

// A variable is findable by its name or what it is set to.
export function matchValues(values, search) {
  const term = (search ?? '').trim().toLowerCase()
  if (!term) return values
  return values.filter(v => v.name.toLowerCase().includes(term) || v.value.toLowerCase().includes(term))
}
