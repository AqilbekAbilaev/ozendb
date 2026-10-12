// How the activity monitor reads and filters what `pg_stat_activity` reported. Pure,
// so the redaction case and the age arithmetic are pinned by a spec.

const SECOND = 1000

// Postgres redacts other users' statements unless the viewing role is superuser or
// holds pg_read_all_stats. The command turns that into `redacted` plus no query, and
// this is where it becomes something to read — an empty cell would look like a bug.
export function queryText(session) {
  if (session.redacted) return '(hidden — you may not read other users\' queries)'
  return session.query || '—'
}

// How long the session has been running its current statement. `now` is a parameter so
// the spec doesn't have to freeze time.
export function fmtAge(start, now = new Date()) {
  if (!start) return '—'
  // Postgres writes "2026-09-30 12:00:00+00": neither the space nor a two-digit
  // offset is ISO, so both are brought up to it before parsing.
  const at = new Date(String(start).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'))
  if (Number.isNaN(at.getTime())) return '—'
  const seconds = Math.floor((now - at) / SECOND)
  if (seconds < 0) return '—'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// The filter dropdowns offer what is actually on the server right now, rather than a
// fixed list that could offer a database nobody is connected to.
const present = (sessions, field) =>
  [...new Set(sessions.map(s => s[field]).filter(Boolean))].sort()

export function sessionOptions(sessions) {
  return {
    databases: present(sessions, 'database'),
    users: present(sessions, 'user'),
    states: present(sessions, 'state'),
  }
}

export function matchSessions(sessions, { database, user, state, activeOnly } = {}) {
  return sessions.filter(s =>
    (!database || s.database === database)
    && (!user || s.user === user)
    && (!state || s.state === state)
    && (!activeOnly || s.state === 'active'))
}

// Cancel leaves the session open, so only a successful terminate may hide its row.
export function shouldSuppressAfterSignal(kind, done) {
  return kind === 'terminate' && done === true
}

// pid alone can be reused by a later backend; backendStart tells them apart. It is null for
// other roles' sessions without pg_read_all_stats — exactly the ones pg_signal_backend can
// terminate — so a null falls back to pid, leaving the TTL to bound any reuse.
function sameBackend(pendingBackendStart, sessionBackendStart) {
  if (pendingBackendStart == null || sessionBackendStart == null) return true
  return pendingBackendStart === sessionBackendStart
}

// Terminate only sends the signal, so a reload can still list the session. Hide it until a
// read no longer has that backend, or the TTL passes in case the terminate never took.
const PENDING_TERMINATION_TTL_MS = 15000

export function reconcilePendingTerminations(freshSessions, pending, now = new Date(), ttlMs = PENDING_TERMINATION_TTL_MS) {
  const isMatch = (p, s) => p.pid === s.pid && sameBackend(p.backendStart, s.backendStart)
  const stillPending = pending.filter(p =>
    now - p.at < ttlMs && freshSessions.some(s => isMatch(p, s)))
  return {
    sessions: freshSessions.filter(s => !stillPending.some(p => isMatch(p, s))),
    pending: stillPending,
  }
}
