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

// Only a successful terminate should hide a row. Cancel leaves the session open, so
// suppressing it would make a live connection vanish from the list — a worse bug than
// the stale-row one this is fixing. A failed terminate didn't change anything either.
export function shouldSuppressAfterSignal(kind, done) {
  return kind === 'terminate' && done === true
}

// Two rows that report the same pid are the same backend only if `backendStart` also
// matches — a pid is a short OS-level integer Postgres reuses once a backend exits, so
// a later, unrelated session can land on the same pid while this modal is still open.
// Either side missing `backendStart` (rare — the column is nullable in principle, see
// activity.rs) means we can't tell the two apart; falling back to matching on pid alone
// re-takes the small, TTL-bounded reuse risk this existed to close, rather than
// silently never suppressing — losing the fix for that one row is worse than a bounded
// risk of it reappearing a little late.
function sameBackend(pendingBackendStart, sessionBackendStart) {
  if (pendingBackendStart == null || sessionBackendStart == null) return true
  return pendingBackendStart === sessionBackendStart
}

// `pg_terminate_backend` only sends the signal; the session can linger in
// `pg_stat_activity` for a bit after it returns true, and the modal's own reload (fired
// from the same action) lands before the server has caught up. `pending` is the set of
// terminate signals the modal has sent but not yet seen take effect — hiding those rows
// is what keeps a just-killed session from reappearing on that reload and on the
// auto-refreshes after it, until a fresh read genuinely no longer has that backend.
//
// An entry is dropped from `pending` — stops being hidden — once the matching backend is
// confirmed gone (including a pid that now belongs to a different backend: that is a
// different session reusing the slot, and from the terminated one's point of view it has
// left). It's also dropped once `ttlMs` passes, for the backend that genuinely never
// leaves: a termination that silently didn't take would otherwise hide that row forever.
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
