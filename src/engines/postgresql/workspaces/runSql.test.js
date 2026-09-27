import { describe, it, expect, vi, beforeEach } from 'vitest'

const runQuery = vi.fn()
const cancelQuery = vi.fn()
const explainQuery = vi.fn()
vi.mock('../api/queries', () => ({ runQuery, cancelQuery, explainQuery }))

const { runSql, cancelSql, explainSql } = await import('./runSql.js')

const tab = (over = {}) => ({ connectionId: 'c1', sql: 'SELECT 1', result: null, error: null, running: false, ...over })

beforeEach(() => vi.resetAllMocks())

describe('runSql', () => {
  it('keeps the result on the tab', async () => {
    const result = { columns: ['?column?'], rows: [[1]], truncated: false, elapsedMs: 2 }
    runQuery.mockResolvedValue(result)
    const t = tab({ error: 'old' })

    await runSql(t)

    expect(runQuery).toHaveBeenCalledWith('c1', 'SELECT 1', expect.any(String))
    expect(t).toMatchObject({ result, error: null, running: false })
  })

  it('keeps the error, and drops the previous result', async () => {
    runQuery.mockRejectedValue({ code: 'command', message: 'syntax error at or near "SELEC"' })
    const t = tab({ result: { columns: [], rows: [] } })

    await runSql(t)

    expect(t).toMatchObject({ result: null, error: 'syntax error at or near "SELEC"', running: false })
  })

  it('runs just the given SQL when a selection is passed', async () => {
    runQuery.mockResolvedValue({ columns: [], rows: [], truncated: false, elapsedMs: 1 })
    await runSql(tab({ sql: 'SELECT 1;\nSELECT 2' }), 'SELECT 2')
    expect(runQuery).toHaveBeenCalledWith('c1', 'SELECT 2', expect.any(String))
  })

  it('logs each run for the Messages tab', async () => {
    const t = tab()
    runQuery.mockResolvedValueOnce({ columns: ['a'], rows: [[1], [2]], truncated: false, elapsedMs: 4 })
    await runSql(t)
    runQuery.mockRejectedValueOnce({ code: 'command', message: 'boom' })
    await runSql(t)
    expect(t.messages.map(m => [m.ok, m.text, m.ms])).toEqual([[true, 'SELECT 2', 4], [false, 'boom', undefined]])
  })

  it('cancels the run in flight by its id, and does nothing once it has ended', async () => {
    let finish
    runQuery.mockImplementation(() => new Promise((resolve, reject) => { finish = reject }))
    const t = tab()
    const running = runSql(t)
    const runId = runQuery.mock.calls[0][2]
    await cancelSql(t)
    expect(cancelQuery).toHaveBeenCalledWith('c1', runId)
    finish({ code: 'cancelled', message: 'The query was cancelled.' })
    await running
    expect(t).toMatchObject({ running: false, error: 'The query was cancelled.' })

    cancelQuery.mockClear()
    await cancelSql(t)
    expect(cancelQuery).not.toHaveBeenCalled()
  })

  it('ignores a run while one is in flight', async () => {
    await runSql(tab({ running: true }))
    expect(runQuery).not.toHaveBeenCalled()
  })

  it('keeps a plan on the tab, or the reason there isn\'t one', async () => {
    const t = tab({ plan: 'old' })
    explainQuery.mockResolvedValueOnce([{ Plan: {} }])
    await explainSql(t, 'SELECT 2')
    expect(explainQuery).toHaveBeenCalledWith('c1', 'SELECT 2')
    expect(t).toMatchObject({ plan: [{ Plan: {} }], planError: null, explaining: false })

    explainQuery.mockRejectedValueOnce({ code: 'command', message: 'syntax error' })
    await explainSql(t)
    expect(t).toMatchObject({ plan: null, planError: 'syntax error', explaining: false })
  })
})
