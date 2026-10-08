import { describe, it, expect } from 'vitest'
import { matchSessions, queryText, fmtAge, sessionOptions, reconcilePendingTerminations, shouldSuppressAfterSignal } from './sessionRows'

const SESSIONS = [
  { pid: 1, user: 'postgres', database: 'shop', state: 'active', query: 'SELECT 1', redacted: false, queryStart: '2026-09-30 12:00:00+00', backendStart: '2026-09-30 11:00:00+00' },
  { pid: 2, user: 'app', database: 'shop', state: 'idle', query: null, redacted: false, queryStart: null, backendStart: '2026-09-30 11:05:00+00' },
  { pid: 3, user: 'app', database: 'billing', state: 'idle in transaction', query: null, redacted: true, queryStart: '2026-09-30 11:00:00+00', backendStart: '2026-09-30 10:00:00+00' },
  // A background worker: no backend_start reported, same as the rest of its fields.
  { pid: 4, user: null, database: null, state: null, query: null, redacted: false, queryStart: null, backendStart: null },
]

describe('queryText', () => {
  it('shows the statement when there is one', () => {
    expect(queryText(SESSIONS[0])).toBe('SELECT 1')
  })

  it('says a hidden query is hidden rather than leaving the row blank', () => {
    expect(queryText(SESSIONS[2])).toBe('(hidden — you may not read other users\' queries)')
  })

  it('says an idle session is idle rather than showing nothing', () => {
    expect(queryText(SESSIONS[1])).toBe('—')
  })
})

describe('fmtAge', () => {
  const now = new Date('2026-09-30T12:00:30Z')

  it('counts seconds for something just started', () => {
    expect(fmtAge('2026-09-30 12:00:00+00', now)).toBe('30s')
  })

  it('counts minutes and seconds', () => {
    expect(fmtAge('2026-09-30 11:58:00+00', now)).toBe('2m 30s')
  })

  it('counts hours once there are some', () => {
    expect(fmtAge('2026-09-30 09:00:00+00', now)).toBe('3h 0m')
  })

  it('has nothing to say without a start', () => {
    expect(fmtAge(null, now)).toBe('—')
  })

  it('refuses a negative age from clocks that disagree', () => {
    expect(fmtAge('2026-09-30 12:01:00+00', now)).toBe('—')
  })
})

describe('sessionOptions', () => {
  it('offers the databases, users and states actually present', () => {
    const options = sessionOptions(SESSIONS)
    expect(options.databases).toEqual(['billing', 'shop'])
    expect(options.users).toEqual(['app', 'postgres'])
    expect(options.states).toEqual(['active', 'idle', 'idle in transaction'])
  })

  it('leaves out the nulls a background worker reports', () => {
    expect(sessionOptions(SESSIONS).users).not.toContain(null)
  })
})

describe('matchSessions', () => {
  it('returns everything with no filters', () => {
    expect(matchSessions(SESSIONS, {})).toHaveLength(4)
  })

  it('filters by database', () => {
    expect(matchSessions(SESSIONS, { database: 'shop' }).map(s => s.pid)).toEqual([1, 2])
  })

  it('filters by user', () => {
    expect(matchSessions(SESSIONS, { user: 'app' }).map(s => s.pid)).toEqual([2, 3])
  })

  it('filters by state', () => {
    expect(matchSessions(SESSIONS, { state: 'active' }).map(s => s.pid)).toEqual([1])
  })

  it('combines filters', () => {
    expect(matchSessions(SESSIONS, { user: 'app', database: 'billing' }).map(s => s.pid)).toEqual([3])
  })

  it('can hide idle sessions, which is the usual reason to open this', () => {
    expect(matchSessions(SESSIONS, { activeOnly: true }).map(s => s.pid)).toEqual([1])
  })

  it('finds nothing rather than everything when nothing matches', () => {
    expect(matchSessions(SESSIONS, { database: 'nope' })).toEqual([])
  })
})

describe('reconcilePendingTerminations', () => {
  const T0 = new Date('2026-09-30T12:00:00Z')
  const PID1_BACKEND_START = '2026-09-30 11:00:00+00'   // matches SESSIONS[0]

  it('hides a session whose terminate just succeeded, even though the reload right after it still reports the row', () => {
    const pending = [{ pid: 1, backendStart: PID1_BACKEND_START, at: T0 }]
    const { sessions } = reconcilePendingTerminations(SESSIONS, pending, T0)
    expect(sessions.map(s => s.pid)).toEqual([2, 3, 4])
  })

  it('keeps hiding it across a later auto-refresh while the server has not caught up yet', () => {
    const pending = [{ pid: 1, backendStart: PID1_BACKEND_START, at: T0 }]
    const threeSecondsLater = new Date(T0.getTime() + 3000)
    const { sessions, pending: next } = reconcilePendingTerminations(SESSIONS, pending, threeSecondsLater)
    expect(sessions.map(s => s.pid)).not.toContain(1)
    expect(next).toEqual(pending)
  })

  it('drops the pending entry once the session is actually gone, rather than carrying it forever', () => {
    const withoutPid1 = SESSIONS.filter(s => s.pid !== 1)
    const pending = [{ pid: 1, backendStart: PID1_BACKEND_START, at: T0 }]
    const { sessions, pending: next } = reconcilePendingTerminations(withoutPid1, pending, T0)
    expect(sessions).toEqual(withoutPid1)
    expect(next).toEqual([])
  })

  it('stops suppressing a pid once the TTL elapses, for a backend that never leaves', () => {
    const pending = [{ pid: 1, backendStart: PID1_BACKEND_START, at: T0 }]
    const wayLater = new Date(T0.getTime() + 20000)
    const { sessions, pending: next } = reconcilePendingTerminations(SESSIONS, pending, wayLater, 15000)
    expect(sessions.map(s => s.pid)).toContain(1)
    expect(next).toEqual([])
  })

  it('leaves the list untouched when nothing is pending', () => {
    const { sessions, pending } = reconcilePendingTerminations(SESSIONS, [], T0)
    expect(sessions).toEqual(SESSIONS)
    expect(pending).toEqual([])
  })

  it('only hides pids that are actually pending, not everything', () => {
    const pending = [{ pid: 3, backendStart: '2026-09-30 10:00:00+00', at: T0 }]
    const { sessions } = reconcilePendingTerminations(SESSIONS, pending, T0)
    expect(sessions.map(s => s.pid)).toEqual([1, 2, 4])
  })

  it('does not hide a row once its pid has been reused by a different backend', () => {
    // The terminated backend had this backendStart; the row sharing its pid now is a
    // later, unrelated session with a different one, so it must stay visible.
    const pending = [{ pid: 1, backendStart: '2026-09-30 05:00:00+00', at: T0 }]
    const { sessions, pending: next } = reconcilePendingTerminations(SESSIONS, pending, T0)
    expect(sessions.map(s => s.pid)).toContain(1)
    expect(next).toEqual([])
  })

  it('falls back to matching by pid alone when backendStart is null, since identity cannot be verified either way', () => {
    const pending = [{ pid: 4, backendStart: null, at: T0 }]
    const { sessions } = reconcilePendingTerminations(SESSIONS, pending, T0)
    expect(sessions.map(s => s.pid)).not.toContain(4)
  })
})

describe('shouldSuppressAfterSignal', () => {
  it('suppresses a session that was actually terminated', () => {
    expect(shouldSuppressAfterSignal('terminate', true)).toBe(true)
  })

  it('never suppresses a cancel — the session stays open and must stay listed', () => {
    expect(shouldSuppressAfterSignal('cancel', true)).toBe(false)
  })

  it('does not suppress a terminate that reported it did nothing', () => {
    expect(shouldSuppressAfterSignal('terminate', false)).toBe(false)
  })
})
