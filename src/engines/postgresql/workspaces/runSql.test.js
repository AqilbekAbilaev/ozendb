import { describe, it, expect, vi, beforeEach } from 'vitest'

const runQuery = vi.fn()
vi.mock('../api/queries', () => ({ runQuery }))

const { runSql } = await import('./runSql.js')

const tab = (over = {}) => ({ connectionId: 'c1', sql: 'SELECT 1', result: null, error: null, running: false, ...over })

beforeEach(() => vi.resetAllMocks())

describe('runSql', () => {
  it('keeps the result on the tab', async () => {
    const result = { columns: ['?column?'], rows: [[1]], truncated: false, elapsedMs: 2 }
    runQuery.mockResolvedValue(result)
    const t = tab({ error: 'old' })

    await runSql(t)

    expect(runQuery).toHaveBeenCalledWith('c1', 'SELECT 1')
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
    expect(runQuery).toHaveBeenCalledWith('c1', 'SELECT 2')
  })

  it('logs each run for the Messages tab', async () => {
    const t = tab()
    runQuery.mockResolvedValueOnce({ columns: ['a'], rows: [[1], [2]], truncated: false, elapsedMs: 4 })
    await runSql(t)
    runQuery.mockRejectedValueOnce({ code: 'command', message: 'boom' })
    await runSql(t)
    expect(t.messages.map(m => [m.ok, m.text, m.ms])).toEqual([[true, 'SELECT 2', 4], [false, 'boom', undefined]])
  })

  it('ignores a run while one is in flight', async () => {
    await runSql(tab({ running: true }))
    expect(runQuery).not.toHaveBeenCalled()
  })
})
