import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { useQueryRunner } from './useQueryRunner'
import { tabs } from '../stores/tabs'

// The timing on the toast is the server's, not this process's. Wall clock here also
// pays for IPC and result marshalling, which grow with the page size and say nothing
// about how fast the query was — so a slow trip home must not inflate the number.

function harness() {
  const toasts = []
  tabs.value = [{ id: 't1', connectionId: 'c1', dbName: 'db', collectionName: 'coll', mode: 'find' }]
  return { api: useQueryRunner({ showToast: (m) => toasts.push(m) }), toasts, tab: tabs.value[0] }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('cancelling', () => {
  it('leaves the calm cancelled state and no timing behind', async () => {
    const { api, toasts, tab } = harness()
    tab.elapsedMs = 999 // a previous run's number, which must not survive this one
    invoke.mockImplementation((cmd, args) => {
      if (cmd === 'find_documents') {
        return new Promise((_, reject) => setTimeout(() => reject(new Error('operation was interrupted')), 20))
      }
      if (cmd === 'kill_query') {
        expect(args.comment).toBe(tab.runId)
        return Promise.resolve(1)
      }
      return Promise.resolve()
    })

    const running = api.runQuery('t1', { filter: '{}', sort: '{}', projection: '{}', skip: 0, limit: 50 })
    await api.cancelQuery('t1')
    await running

    expect(tab.isRunning).toBe(false)
    expect(tab.runError).toBe('Query cancelled.')
    expect(tab.runErrorCode).toBe(null)
    expect(tab.elapsedMs).toBe(null)
    expect(toasts).toContain('Query cancelled')
  })

  // Killing the server op is best-effort: the op can already have finished, with the
  // response still on its way back over IPC. The cancel has to hold anyway, or the
  // user watches the results they just cancelled arrive and render.
  it('drops results that land after the cancel', async () => {
    const { api, toasts, tab } = harness()
    invoke.mockImplementation((cmd) => {
      if (cmd === 'find_documents') {
        return new Promise(r => setTimeout(() => r({ documents: [{ a: 1 }], elapsedMs: 5 }), 20))
      }
      if (cmd === 'kill_query') return Promise.resolve(0) // nothing left to kill
      return Promise.resolve()
    })

    const running = api.runQuery('t1', { filter: '{}', sort: '{}', projection: '{}', skip: 0, limit: 50 })
    await api.cancelQuery('t1')
    // The spinner stops on the click, not when the abandoned response happens to land.
    expect(tab.isRunning).toBe(false)
    await running

    expect(tab.results ?? []).toEqual([])
    expect(tab.hasRun).toBeFalsy()
    expect(tab.runError).toBe('Query cancelled.')
    expect(toasts).toContain('Query cancelled')
  })

  it('drops results overtaken by a newer run', async () => {
    const { api, tab } = harness()
    invoke.mockImplementation((cmd, args) => {
      if (cmd !== 'find_documents') return Promise.resolve()
      const slow = args.skip === 0
      return new Promise(r => setTimeout(
        () => r({ documents: [{ run: slow ? 'first' : 'second' }], elapsedMs: 5 }),
        slow ? 30 : 1,
      ))
    })

    const first = api.runQuery('t1', { filter: '{}', sort: '{}', projection: '{}', skip: 0, limit: 50 })
    await api.runQuery('t1', { filter: '{}', sort: '{}', projection: '{}', skip: 50, limit: 50 })
    await first

    expect(tab.results).toEqual([{ run: 'second' }])
    expect(tab.isRunning).toBe(false)
  })
})

describe('reported timing', () => {
  it('reports what the server took, not the round trip', async () => {
    const { api, toasts, tab } = harness()
    invoke.mockImplementation((cmd) => {
      if (cmd !== 'find_documents') return Promise.resolve()
      // A slow trip home on top of a fast query.
      return new Promise(r => setTimeout(() => r({ documents: [{ a: 1 }], elapsedMs: 12 }), 40))
    })

    await api.runQuery('t1', { filter: '{}', sort: '{}', projection: '{}', skip: 0, limit: 50 })

    expect(tab.elapsedMs).toBe(12)
    expect(toasts[0]).toBe('Query returned 1 document in 0.012s')
  })

  it('reports the server timing for an aggregation too', async () => {
    const { api, toasts, tab } = harness()
    invoke.mockImplementation((cmd) => {
      if (cmd !== 'run_aggregate') return Promise.resolve()
      return Promise.resolve({ documents: [{ a: 1 }, { a: 2 }], truncated: false, elapsedMs: 7 })
    })

    await api.runAggregate('t1', { pipeline: '[]' })

    expect(tab.elapsedMs).toBe(7)
    expect(toasts[0]).toBe('Aggregation returned 2 documents in 0.007s')
  })
})
