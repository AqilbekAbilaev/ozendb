import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../api/queries', () => ({
  explainFind: vi.fn(), explainAggregate: vi.fn(), loadExplainStorage: vi.fn(), translateSqlToMql: vi.fn(),
}))

import { nextTick, reactive } from 'vue'
import { explainAggregate } from '../../api/queries'
import { requestRefresh } from '../../../../stores/menuRequests'
import { createCollectionState, createCollectionRuntime } from '../collectionState'
import { useCollectionRun } from './useCollectionRun'

function setup({ mode = 'find', query = {}, resultTab = 'Result' } = {}) {
  const state = createCollectionState()
  Object.assign(state.query, query)
  const tab = reactive({ id: 't1', kind: 'collection', mode, connectionId: 'c1', dbName: 'shop', collectionName: 'orders', state, runtime: createCollectionRuntime() })
  const props = reactive({ activeTab: tab, tabs: [tab], resultTab, savedQueryRequest: null })
  const emit = vi.fn()
  const run = useCollectionRun({
    activeTab: () => props.activeTab, tabs: () => props.tabs,
    resultTab: () => props.resultTab, savedQueryRequest: () => props.savedQueryRequest,
  }, emit)
  return { tab, props, emit, run }
}

beforeEach(() => {
  vi.clearAllMocks()
  explainAggregate.mockResolvedValue({})
})

describe('find', () => {
  it('runs the parsed query with paging, expanding a bare ObjectId first', () => {
    const { tab, emit, run } = setup({ query: { filter: '507f1f77bcf86cd799439011', limit: 20 } })
    run.run()
    expect(tab.state.query.filter).toBe('{ _id: ObjectId("507f1f77bcf86cd799439011") }')
    expect(emit).toHaveBeenCalledWith('run-query', 't1', expect.objectContaining({ skip: 0, limit: 20, addToHistory: true }))
  })

  it('will not run a query that does not parse, and says which field is wrong', () => {
    const { emit, run } = setup({ query: { sort: '{ a: ' } })
    expect(run.runValid.value).toBe(false)
    expect(run.queryErrorText.value).toMatch(/^Sort: /)
    run.run()
    expect(emit).not.toHaveBeenCalled()
  })
})

describe('aggregate', () => {
  it('runs the pipeline, and refreshes the plan while Explain is showing', async () => {
    const { emit, run } = setup({ mode: 'aggregate', query: { pipeline: '[]' }, resultTab: 'Explain' })
    run.run()
    expect(emit).toHaveBeenCalledWith('run-aggregate', 't1', { pipeline: '[]' })
    expect(explainAggregate).toHaveBeenCalled()
  })

  it('reports a broken pipeline instead of running it', () => {
    const { emit, run } = setup({ mode: 'aggregate', query: { pipeline: '[ { $match: ' } })
    expect(run.pipelineErrorText.value).toMatch(/^Pipeline: /)
    run.run()
    expect(emit).not.toHaveBeenCalled()
  })
})

describe('wiring', () => {
  it('switches result sub-tab, fetching the plan when Explain opens', () => {
    const { emit, run } = setup({ mode: 'aggregate', query: { pipeline: '[]' } })
    run.selectRtab('Explain')
    expect(emit).toHaveBeenCalledWith('update:result-tab', 'Explain')
    expect(explainAggregate).toHaveBeenCalled()
  })

  it('applies a saved query to the tab, runs it, then acknowledges it', async () => {
    const { tab, props, emit } = setup()
    props.savedQueryRequest = {
      nonce: 7, tabId: 't1',
      entry: { mode: 'find', filter: '{ b: 2 }', sort: '', projection: '', skip: '10', limit: '5' },
    }
    await nextTick(); await nextTick(); await nextTick()
    expect(tab.state.query).toMatchObject({ filter: '{ b: 2 }', skip: 10, limit: 5 })
    expect(emit).toHaveBeenCalledWith('run-query', 't1', expect.objectContaining({ skip: 10, limit: 5 }))
    expect(emit).toHaveBeenCalledWith('saved-query-applied', 7)
  })

  it('reruns on View → Refresh', async () => {
    const { emit } = setup()
    requestRefresh()
    await nextTick()
    expect(emit).toHaveBeenCalledWith('run-query', 't1', expect.any(Object))
  })
})
