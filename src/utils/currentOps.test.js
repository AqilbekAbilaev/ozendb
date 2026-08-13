import { describe, it, expect } from 'vitest'
import { normalizeOps, mergeRetained, filterOps } from './currentOps'

// A trimmed but faithful `currentOp` reply: one app query (tagged with its run id), one
// internal thread, one driver heartbeat.
const reply = {
  inprog: [
    {
      type: 'op', desc: 'conn114', connectionId: 114, client: '127.0.0.1:49368',
      opid: 1380004, op: 'query', ns: 'testify.groups', secs_running: 16,
      appName: 'OzenDB', planSummary: 'COLLSCAN', numYields: 1, waitingForLock: false,
      effectiveUsers: [{ user: 'dalton', db: 'admin' }],
      command: {
        find: 'groups', comment: 'q1786608095277-cd5un7', filter: {},
        lsid: { id: 'uuid' }, $db: 'testify', $readPreference: { mode: 'primary' },
      },
    },
    { type: 'op', desc: 'Checkpointer', opid: 1379562, op: 'none', ns: '' },
    {
      type: 'op', desc: 'conn5', connectionId: 5, client: '127.0.0.1:38900',
      opid: 1380209, op: 'command', ns: 'admin.$cmd', secs_running: 0,
      command: { hello: 1 },
    },
  ],
  ok: 1,
}

describe('normalizeOps', () => {
  it('reads the columns the table shows', () => {
    const [query] = normalizeOps(reply)
    expect(query).toMatchObject({
      key: '1380004', opid: 1380004, type: 'query', ns: 'testify.groups',
      secs: 16, client: '127.0.0.1:49368', desc: 'conn114',
    })
  })

  // The comment is the run id the query runner stamps on every op, so it is the one
  // column that ties a row on screen back to a tab in this app.
  it('surfaces the run id from the command comment', () => {
    expect(normalizeOps(reply)[0].comment).toBe('q1786608095277-cd5un7')
    expect(normalizeOps(reply)[1].comment).toBe('')
  })

  // Internal threads have no client connection behind them — that is what separates
  // "the server's own housekeeping" from "someone's query".
  it('marks server threads as sys ops', () => {
    expect(normalizeOps(reply).map(o => o.sys)).toEqual([false, true, false])
  })

  it('reads the columns that explain a slow op', () => {
    const [query] = normalizeOps(reply)
    expect(query).toMatchObject({
      plan: 'COLLSCAN', app: 'OzenDB', user: 'dalton', yields: 1, waiting: false,
    })
  })

  // The client's own name is the readable one; a driver-only connection (our own, most
  // services) has none, so the driver stands in rather than an empty cell.
  it('falls back to the driver when the client set no application name', () => {
    const ops = normalizeOps({ inprog: [{
      opid: 1, connectionId: 1, clientMetadata: { driver: { name: 'mongo-rust-driver' } },
    }] })
    expect(ops[0].app).toBe('mongo-rust-driver')
  })

  describe('command summary', () => {
    // Session ids, $db and read preference are on every command and say nothing about
    // what it does — they'd push the actual query out of a one-line cell.
    it('drops the per-command boilerplate', () => {
      const summary = normalizeOps(reply)[0].command
      expect(summary).toContain('find')
      expect(summary).toContain('groups')
      expect(summary).not.toContain('lsid')
      expect(summary).not.toContain('$db')
      expect(summary).not.toContain('$readPreference')
    })

    it('truncates a long command rather than letting it run away', () => {
      const ops = normalizeOps({ inprog: [{
        opid: 1, connectionId: 1, command: { find: 'c', filter: { note: 'x'.repeat(400) } },
      }] })
      expect(ops[0].command.length).toBeLessThanOrEqual(121)
      expect(ops[0].command.endsWith('…')).toBe(true)
    })

    it('is empty for an op with no command', () => {
      expect(normalizeOps(reply)[1].command).toBe('')
    })
  })

  it('survives a reply with nothing in progress', () => {
    expect(normalizeOps({ inprog: [], ok: 1 })).toEqual([])
    expect(normalizeOps(null)).toEqual([])
    expect(normalizeOps({})).toEqual([])
  })
})

const row = (key, over = {}) => ({ key: key, opid: Number(key), ns: 'db.c', ...over })

describe('mergeRetained', () => {
  it('keeps the latest state of an op that is still running', () => {
    const merged = mergeRetained([row('1', { secs: 1 })], [row('1', { secs: 4 })], 10_000, 1000)
    expect(merged).toEqual([expect.objectContaining({ key: '1', secs: 4, expiredAt: null })])
  })

  // Without retention a fast op appears and vanishes between two polls and is never
  // seen; retention is what makes a 1-second query readable at a 2-second poll.
  it('holds on to an op that has gone, until its time is up', () => {
    const gone = mergeRetained([row('1')], [], 10_000, 1000)
    expect(gone).toEqual([expect.objectContaining({ key: '1', expiredAt: 1000 })])

    const later = mergeRetained(gone, [], 10_000, 5000)
    expect(later[0].expiredAt).toBe(1000) // the clock starts when it went, not on every poll

    expect(mergeRetained(gone, [], 10_000, 11_000)).toEqual([])
  })

  it('drops a vanished op immediately when retention is off', () => {
    expect(mergeRetained([row('1')], [], 0, 1000)).toEqual([])
  })

  it('un-expires an op that comes back', () => {
    const gone = mergeRetained([row('1')], [], 10_000, 1000)
    const back = mergeRetained(gone, [row('1')], 10_000, 2000)
    expect(back[0].expiredAt).toBe(null)
  })

  it('appends ops it has not seen before', () => {
    const merged = mergeRetained([row('1')], [row('1'), row('2')], 10_000, 1000)
    expect(merged.map(o => o.key)).toEqual(['1', '2'])
  })
})

describe('filterOps', () => {
  const rows = normalizeOps(reply)  // app query on testify.groups, Checkpointer, a hello on admin.$cmd

  it('keeps everything when nothing is asked of it', () => {
    expect(filterOps(rows, { showSys: true }).length).toBe(3)
  })

  // The reason this filter exists: the checkpointer and journal flusher are always
  // there, and they are never what you opened the tab to look at.
  it('drops server threads unless sys ops are wanted', () => {
    expect(filterOps(rows, {}).map(o => o.desc)).toEqual(['conn114', 'conn5'])
  })

  it('narrows to a database, then to a collection', () => {
    expect(filterOps(rows, { dbName: 'testify' }).map(o => o.ns)).toEqual(['testify.groups'])
    expect(filterOps(rows, { dbName: 'testify', collName: 'groups' }).map(o => o.ns)).toEqual(['testify.groups'])
    expect(filterOps(rows, { dbName: 'testify', collName: 'other' })).toEqual([])
  })

  // A database whose name is a prefix of another must not drag it in.
  it('matches a namespace on its whole database name', () => {
    const ops = normalizeOps({ inprog: [{ opid: 1, connectionId: 1, ns: 'testifyOther.groups' }] })
    expect(filterOps(ops, { dbName: 'testify' })).toEqual([])
  })

  it('hides ops running under the slow threshold', () => {
    expect(filterOps(rows, { slowOnly: true, slowSecs: 3 }).map(o => o.secs)).toEqual([16])
    expect(filterOps(rows, { slowOnly: true, slowSecs: 30 })).toEqual([])
  })

  // An op held on screen after it finished has stopped ticking; judging it by the live
  // threshold would make it vanish the moment it expired.
  it('keeps retained ops regardless of the slow threshold', () => {
    const expired = [{ ...rows[2], expiredAt: 1000 }]
    expect(filterOps(expired, { slowOnly: true, slowSecs: 30 }).length).toBe(1)
  })
})
