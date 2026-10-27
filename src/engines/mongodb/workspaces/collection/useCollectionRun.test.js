import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../api/queries', () => ({
  explainFind: vi.fn(), explainAggregate: vi.fn(), loadExplainStorage: vi.fn(), translateSqlToMql: vi.fn(),
  runFind: vi.fn(), runAggregate: vi.fn(), cancelRun: vi.fn(),
}))
vi.mock('../../api/queryLibrary', () => ({ pushQueryHistory: vi.fn(), getDefaultQuery: vi.fn() }))

import { nextTick, reactive } from 'vue'
import { explainAggregate, runFind, runAggregate, cancelRun } from '../../api/queries'
import { pushQueryHistory } from '../../api/queryLibrary'
import { requestRefresh } from '../../../../stores/menuRequests'
import { tabs } from '../../../../stores/tabs'
import { createCollectionState, createCollectionRuntime } from '../collectionState'
import { useCollectionRun } from './useCollectionRun'
import { createResourceRef } from '../../../../utils/resourceRef'
import { registerWorkspaceDefinitions } from '../../../../workspaces/registerDefinitions'

// Whether a tab is a collection tab is a question for its definition.
registerWorkspaceDefinitions()

// The query runner finds its tab in the tab store and calls the API with this target.
const ORDERS = { connectionId: 'c1', database: 'shop', collection: 'orders' }

function setup({ mode = 'find', query = {}, resultTab = 'Result' } = {}) {
  const state = createCollectionState()
  Object.assign(state.query, query)
  const tab = reactive({ id: 't1', type: 'mongodb.find', mode, target: createResourceRef('c1', [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }]), state, runtime: createCollectionRuntime() })
  tabs.value = [tab]
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
  runFind.mockResolvedValue({ documents: [], elapsedMs: 4 })
  runAggregate.mockResolvedValue({ documents: [], elapsedMs: 4 })
  cancelRun.mockResolvedValue(1)
  pushQueryHistory.mockResolvedValue(null)
})

describe('find', () => {
  it('runs the parsed query with paging, expanding a bare ObjectId first', async () => {
    const { tab, run } = setup({ query: { filter: '507f1f77bcf86cd799439011', limit: 20 } })
    run.run()
    expect(tab.state.query.filter).toBe('{ _id: ObjectId("507f1f77bcf86cd799439011") }')
    expect(runFind).toHaveBeenCalledWith(ORDERS, {
      filter: '{"_id":{"$oid":"507f1f77bcf86cd799439011"}}', projection: '{}', sort: '{}', skip: 0, limit: 20,
    }, expect.any(String))
    await vi.waitFor(() => expect(pushQueryHistory).toHaveBeenCalled())
  })

  it('will not run a query that does not parse, and says which field is wrong', () => {
    const { emit, run } = setup({ query: { sort: '{ a: ' } })
    expect(run.runValid.value).toBe(false)
    expect(run.queryErrorText.value).toMatch(/^Sort: /)
    run.run()
    expect(runFind).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })
})

describe('aggregate', () => {
  it('runs the pipeline, and refreshes the plan while Explain is showing', async () => {
    const { run } = setup({ mode: 'aggregate', query: { pipeline: '[]' }, resultTab: 'Explain' })
    run.run()
    expect(runAggregate).toHaveBeenCalledWith(ORDERS, '[]', expect.any(String))
    expect(explainAggregate).toHaveBeenCalled()
  })

  it('reports a broken pipeline instead of running it', () => {
    const { emit, run } = setup({ mode: 'aggregate', query: { pipeline: '[ { $match: ' } })
    expect(run.pipelineErrorText.value).toMatch(/^Pipeline: /)
    run.run()
    expect(runAggregate).not.toHaveBeenCalled()
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
    expect(runFind).toHaveBeenCalledWith(ORDERS, expect.objectContaining({ skip: 10, limit: 5 }), expect.any(String))
    expect(emit).toHaveBeenCalledWith('saved-query-applied', 7)
  })

  it('reruns on View → Refresh', async () => {
    setup()
    requestRefresh()
    await nextTick()
    expect(runFind).toHaveBeenCalledWith(ORDERS, expect.any(Object), expect.any(String))
  })

  it('cancels the running query on its own tab', () => {
    const { tab, run } = setup()
    tab.runtime.isRunning = true
    tab.runtime.runId = 'q-7 ü'
    run.cancel()
    expect(cancelRun).toHaveBeenCalledWith('c1', 'q-7 ü')
    expect(tab.runtime.runError).toBe('Query cancelled.')
  })

  it('follows a reference into a new Find tab that runs the referenced filter', () => {
    const { run } = setup()
    const resource = createResourceRef('c1', [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'cust.omers ü' }])
    run.followReference({ resource, connectionName: 'Sales', filter: '{ _id: 7 }' })
    const opened = tabs.value[tabs.value.length - 1]
    expect(opened).toMatchObject({ type: 'mongodb.find', target: resource })
    expect(opened.state.query.filter).toBe('{ _id: 7 }')
    expect(runFind).toHaveBeenCalledWith(
      { connectionId: 'c1', database: 'shop', collection: 'cust.omers ü' },
      expect.objectContaining({ filter: '{"_id":{"$numberInt":"7"}}' }), expect.any(String),
    )
  })
})
