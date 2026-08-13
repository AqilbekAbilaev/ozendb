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
