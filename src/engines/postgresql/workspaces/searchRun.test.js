import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive } from 'vue'

const searchTables = vi.fn()
vi.mock('../api/resources', () => ({ searchTables }))
const cancelQuery = vi.fn(() => Promise.resolve())
vi.mock('../api/queries', () => ({ cancelQuery }))

const { createSearchState, createSearchRuntime, runSearch, cancelSearch } = await import('./searchRun.js')

const tabOf = (state = {}) => reactive({
  connectionId: 'c1', database: 'app', schema: 'public',
  state: { ...createSearchState(), ...state }, runtime: createSearchRuntime(),
})

beforeEach(() => vi.resetAllMocks())

describe('runSearch', () => {
  it('searches the tab\'s schema with its options and keeps the result on the tab', async () => {
    const result = { matches: [{ table: 'users', column: 'name', value: 'Ada', primaryKey: { id: 1 } }], truncated: false, skipped: [] }
    searchTables.mockResolvedValue(result)
    const tab = tabOf({ term: '  Ada ', tables: 'users, orders', matchCase: true })
    await runSearch(tab)
    expect(searchTables).toHaveBeenCalledWith(
      { connectionId: 'c1', schema: 'public', tables: ['users', 'orders'] },
      'Ada',
      { matchCase: true, regex: false, runId: expect.any(String) },
    )
    expect(tab.runtime).toMatchObject({ result, loading: false, error: null, runId: null })
  })

  it('searches every table when the list is blank', async () => {
    searchTables.mockResolvedValue({ matches: [], truncated: false, skipped: [] })
    await runSearch(tabOf({ term: 'x', tables: ' , ' }))
    expect(searchTables.mock.calls[0][0].tables).toBe(null)
  })

  it('keeps the error, and no result, when the search fails', async () => {
    searchTables.mockRejectedValue({ code: 'invalid_input', message: 'invalid regular expression' })
    const tab = tabOf({ term: '(', regex: true })
    await runSearch(tab)
    expect(tab.runtime).toMatchObject({ result: null, loading: false, error: 'invalid regular expression', errorCode: 'invalid_input' })
  })

  it('does nothing for a blank term or while a search is running', async () => {
    await runSearch(tabOf({ term: '   ' }))
    const busy = tabOf({ term: 'x' })
    busy.runtime.loading = true
    await runSearch(busy)
    expect(searchTables).not.toHaveBeenCalled()
  })
})

describe('cancelSearch', () => {
  it('cancels the running search by its run id', () => {
    const tab = tabOf()
    tab.runtime.runId = 'r1'
    cancelSearch(tab)
    expect(cancelQuery).toHaveBeenCalledWith('c1', 'r1')
  })

  it('does nothing when nothing is running', () => {
    cancelSearch(tabOf())
    expect(cancelQuery).not.toHaveBeenCalled()
  })
})
