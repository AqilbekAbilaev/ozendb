import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../api/queries', () => ({ explainFind: vi.fn(), explainAggregate: vi.fn(), loadExplainStorage: vi.fn() }))

import { explainFind, explainAggregate, loadExplainStorage } from '../../api/queries'
import { createCollectionState, createCollectionRuntime } from '../collectionState'
import { runExplain } from './runExplain'

const TARGET = { connectionId: 'c1', database: 'shop', collection: 'orders' }
const open = () => true

function tab(mode = 'find', query = {}) {
  const state = createCollectionState()
  Object.assign(state.query, query)
  return { id: 't1', kind: 'collection', mode, connectionId: 'c1', dbName: 'shop', collectionName: 'orders', state, runtime: createCollectionRuntime() }
}

beforeEach(() => {
  vi.clearAllMocks()
  explainFind.mockResolvedValue({ plan: 'find' })
  explainAggregate.mockResolvedValue({ plan: 'agg' })
  loadExplainStorage.mockResolvedValue({ size: 1 })
})

describe('runExplain', () => {
  it('explains a find with the default verbosity, then loads its storage sizes', async () => {
    const t = tab('find', { filter: '{ a: 1 }', skip: 5 })
    await runExplain(t, open)
    expect(explainFind).toHaveBeenCalledWith(TARGET, expect.objectContaining({ skip: 5, limit: 50 }), 'executionStats')
    expect(t.runtime).toMatchObject({ explainResult: { plan: 'find' }, explainStorage: { size: 1 }, explainRunning: false, explainError: null })
  })

  it('explains an aggregate tab\'s pipeline, with no storage step', async () => {
    const t = tab('aggregate', { pipeline: '[ { $match: { a: 1 } } ]' })
    t.runtime.explainVerbosity = 'queryPlanner'
    await runExplain(t, open)
    expect(explainAggregate).toHaveBeenCalledWith(TARGET, expect.any(String), 'queryPlanner')
    expect(loadExplainStorage).not.toHaveBeenCalled()
    expect(t.runtime.explainResult).toEqual({ plan: 'agg' })
  })

  it('asks for a fixed query instead of explaining a broken one', async () => {
    const t = tab('find', { filter: '{ a: ' })
    await runExplain(t, open)
    expect(explainFind).not.toHaveBeenCalled()
    expect(t.runtime.explainError).toBe('Fix the query before running Explain.')
  })

  it('drops the plan of a tab that was closed meanwhile', async () => {
    const t = tab()
    await runExplain(t, () => false)
    expect(t.runtime.explainResult).toBe(null)
  })

  it('shows a failed explain as its error', async () => {
    explainFind.mockRejectedValue({ code: 'command', message: 'no such cmd' })
    const t = tab()
    await runExplain(t, open)
    expect(t.runtime).toMatchObject({ explainError: 'no such cmd', explainResult: null, explainRunning: false })
  })

  it('keeps the plan when only the storage sizes fail', async () => {
    loadExplainStorage.mockRejectedValue(new Error('nope'))
    const t = tab()
    await runExplain(t, open)
    expect(t.runtime).toMatchObject({ explainResult: { plan: 'find' }, explainStorage: null, explainError: null })
  })
})
