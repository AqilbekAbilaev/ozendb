import { describe, it, expect } from 'vitest'
import { normalizeOps, mergeRetained } from './currentOps'

// A trimmed but faithful `currentOp` reply: one app query (tagged with its run id), one
// internal thread, one driver heartbeat.
const reply = {
  inprog: [
    {
      type: 'op', desc: 'conn114', connectionId: 114, client: '127.0.0.1:49368',
      opid: 1380004, op: 'query', ns: 'testify.groups', secs_running: 16,
      command: { find: 'groups', comment: 'q1786608095277-cd5un7', filter: {} },
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
