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

  it('ignores a run while one is in flight', async () => {
    await runSql(tab({ running: true }))
    expect(runQuery).not.toHaveBeenCalled()
  })
})
