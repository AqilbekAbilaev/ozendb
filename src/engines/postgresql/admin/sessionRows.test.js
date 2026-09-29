import { describe, it, expect } from 'vitest'
import { matchSessions, queryText, fmtAge, sessionOptions } from './sessionRows'

const SESSIONS = [
  { pid: 1, user: 'postgres', database: 'shop', state: 'active', query: 'SELECT 1', redacted: false, queryStart: '2026-09-30 12:00:00+00' },
  { pid: 2, user: 'app', database: 'shop', state: 'idle', query: null, redacted: false, queryStart: null },
  { pid: 3, user: 'app', database: 'billing', state: 'idle in transaction', query: null, redacted: true, queryStart: '2026-09-30 11:00:00+00' },
  { pid: 4, user: null, database: null, state: null, query: null, redacted: false, queryStart: null },
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
