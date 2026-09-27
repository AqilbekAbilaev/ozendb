import { describe, it, expect, vi, beforeEach } from 'vitest'

const runQuery = vi.fn()
const cancelQuery = vi.fn()
const explainQuery = vi.fn()
const formatQuery = vi.fn()
const beginTransaction = vi.fn()
const commitTransaction = vi.fn()
const rollbackTransaction = vi.fn()
vi.mock('../api/queries', () => ({ runQuery, cancelQuery, explainQuery, formatQuery, beginTransaction, commitTransaction, rollbackTransaction }))
const pushHistory = vi.fn()
vi.mock('../api/library', () => ({ pushHistory }))

const { runSql, cancelSql, explainSql, formatSql, endTransaction, abandonTransaction } = await import('./runSql.js')

const tab = (over = {}) => ({ connectionId: 'c1', sql: 'SELECT 1', result: null, error: null, running: false, ...over })

beforeEach(() => {
  vi.resetAllMocks()
  pushHistory.mockResolvedValue(null)
})

describe('runSql', () => {
  it('keeps the result on the tab', async () => {
    const result = { columns: ['?column?'], rows: [[1]], truncated: false, elapsedMs: 2 }
    runQuery.mockResolvedValue(result)
    const t = tab({ error: 'old' })

    await runSql(t)

    expect(runQuery).toHaveBeenCalledWith('c1', 'SELECT 1', expect.any(String), null)
    expect(t).toMatchObject({ result, error: null, running: false })
  })

  it('adds the SQL it ran to the connection\'s history, but not a failed run', async () => {
    runQuery.mockResolvedValueOnce({ columns: [], rows: [], truncated: false, elapsedMs: 1 })
    await runSql(tab(), 'SELECT 2')
    expect(pushHistory).toHaveBeenCalledWith('c1', 'SELECT 2')

    runQuery.mockRejectedValueOnce({ code: 'command', message: 'nope' })
    await runSql(tab())
    expect(pushHistory).toHaveBeenCalledTimes(1)
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
    expect(runQuery).toHaveBeenCalledWith('c1', 'SELECT 2', expect.any(String), null)
  })

  it('logs each run for the Messages tab', async () => {
    const t = tab()
    runQuery.mockResolvedValueOnce({ columns: ['a'], rows: [[1], [2]], truncated: false, elapsedMs: 4 })
    await runSql(t)
    runQuery.mockRejectedValueOnce({ code: 'command', message: 'boom' })
    await runSql(t)
    expect(t.messages.map(m => [m.ok, m.text, m.ms])).toEqual([[true, 'SELECT 2', 4], [false, 'boom', undefined]])
  })

  it('logs how many rows a statement changed', async () => {
    const t = tab({ sql: 'DELETE FROM t' })
    runQuery.mockResolvedValueOnce({ columns: [], rows: [], truncated: false, elapsedMs: 2, rowsAffected: 1 })
    await runSql(t)
    runQuery.mockResolvedValueOnce({ columns: [], rows: [], truncated: false, elapsedMs: 2, rowsAffected: 3 })
    await runSql(t)
    expect(t.messages.map(m => m.text)).toEqual(['1 row affected', '3 rows affected'])
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

describe('formatSql', () => {
  it('replaces the SQL with its formatted form', async () => {
    formatQuery.mockResolvedValue('SELECT\n  1;')
    const t = tab({ sql: 'select 1' })
    expect(await formatSql(t)).toBeNull()
    expect(formatQuery).toHaveBeenCalledWith('select 1')
    expect(t.sql).toBe('SELECT\n  1;')
  })

  it('leaves SQL it cannot format as typed, and says why', async () => {
    formatQuery.mockRejectedValue({ code: 'sql', message: 'SQL with comments isn\'t formatted' })
    const t = tab({ sql: 'select 1 -- x' })
    expect(await formatSql(t)).toBe('SQL with comments isn\'t formatted')
    expect(t.sql).toBe('select 1 -- x')
  })
})

describe('Manual transactions', () => {
  const ok = { columns: [], rows: [], truncated: false, elapsedMs: 1, rowsAffected: 1 }

  it('begins one on the first run and runs every run in it until it ends', async () => {
    runQuery.mockResolvedValue(ok)
    const t = tab({ txn: 'manual', sql: 'DELETE FROM t' })
    await runSql(t)
    await runSql(t)
    expect(beginTransaction).toHaveBeenCalledTimes(1)
    const txId = beginTransaction.mock.calls[0][1]
    expect(beginTransaction).toHaveBeenCalledWith('c1', txId)
    expect(runQuery.mock.calls.map(c => c[3])).toEqual([txId, txId])
    expect(t.txId).toBe(txId)

    await endTransaction(t, true)
    expect(commitTransaction).toHaveBeenCalledWith(txId)
    expect(t.txId).toBeNull()
    expect(t.messages.at(-1)).toMatchObject({ ok: true, text: 'COMMIT' })

    await runSql(t)
    await endTransaction(t, false)
    expect(beginTransaction).toHaveBeenCalledTimes(2)
    expect(rollbackTransaction).toHaveBeenCalledWith(beginTransaction.mock.calls[1][1])
    expect(t.messages.at(-1)).toMatchObject({ ok: true, text: 'ROLLBACK' })
  })

  it('reports a commit that failed, and the transaction is over either way', async () => {
    runQuery.mockResolvedValue(ok)
    commitTransaction.mockRejectedValue({ code: 'validation', message: 'nothing was committed' })
    const t = tab({ txn: 'manual' })
    await runSql(t)
    await endTransaction(t, true)
    expect(t.txId).toBeNull()
    expect(t.messages.at(-1)).toMatchObject({ ok: false, text: 'nothing was committed' })
  })

  it('does not run when the transaction could not begin', async () => {
    beginTransaction.mockRejectedValue({ code: 'connection', message: 'no route' })
    const t = tab({ txn: 'manual' })
    await runSql(t)
    expect(runQuery).not.toHaveBeenCalled()
    expect(t).toMatchObject({ error: 'no route', running: false })
    expect(t.txId).toBeFalsy()
  })

  it('auto-commit runs outside any transaction', async () => {
    runQuery.mockResolvedValue(ok)
    await runSql(tab())
    expect(beginTransaction).not.toHaveBeenCalled()
    expect(runQuery.mock.calls[0][3]).toBeNull()
  })

  it('rolls back an open transaction when its tab goes away', async () => {
    runQuery.mockResolvedValue(ok)
    const t = tab({ txn: 'manual' })
    expect(await abandonTransaction(t)).toBe(false)
    await runSql(t)
    const txId = t.txId
    expect(await abandonTransaction(t)).toBe(true)
    expect(rollbackTransaction).toHaveBeenCalledWith(txId)
  })
})
