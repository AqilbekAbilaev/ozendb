import { describe, expect, it, vi } from 'vitest'
import { runTranslatedSql } from './sqlWorkspace'

describe('runTranslatedSql', () => {
  it('runs and explains the workspace that started a delayed translation', async () => {
    const first = { id: 'first', mode: 'sql', sql: 'SELECT * FROM orders', limit: 25 }
    const second = { id: 'second' }
    let active = first
    let finishTranslation
    const translate = vi.fn(() => new Promise(resolve => { finishTranslation = resolve }))
    const runQuery = vi.fn()
    const runExplain = vi.fn()

    const running = runTranslatedSql(first, {
      translate,
      runQuery,
      runExplain,
      explainVisible: () => true,
      isCurrent: tab => tab.mode === 'sql',
    })
    active = second
    finishTranslation({ filter: '{}', projection: '{}', sort: '{}', skip: 0, limit: 10 })
    await running

    expect(active).toBe(second)
    expect(runQuery).toHaveBeenCalledWith(first, expect.objectContaining({ limit: 10 }))
    expect(runExplain).toHaveBeenCalledWith(first)
  })

  it('keeps translation errors on the initiating workspace', async () => {
    const tab = { id: 'first', mode: 'sql', sql: 'bad sql' }

    await runTranslatedSql(tab, {
      translate: vi.fn().mockRejectedValue({ message: 'invalid SQL' }),
      runQuery: vi.fn(),
      runExplain: vi.fn(),
      explainVisible: () => false,
      isCurrent: candidate => candidate.mode === 'sql',
    })

    expect(tab.sqlError).toBe('invalid SQL')
  })

  it('ignores an older translation that finishes after a newer one', async () => {
    const tab = { id: 'first', mode: 'sql', sql: 'first', limit: 25 }
    const resolvers = []
    const translate = vi.fn(() => new Promise(resolve => resolvers.push(resolve)))
    const runQuery = vi.fn()
    const deps = {
      translate,
      runQuery,
      runExplain: vi.fn(),
      explainVisible: () => false,
      isCurrent: candidate => candidate.mode === 'sql',
    }

    const first = runTranslatedSql(tab, deps)
    tab.sql = 'second'
    const second = runTranslatedSql(tab, deps)
    resolvers[1]({ filter: '{ "new": true }', projection: '{}', sort: '{}', limit: 20 })
    await second
    resolvers[0]({ filter: '{ "old": true }', projection: '{}', sort: '{}', limit: 10 })
    await first

    expect(tab.filter).toBe('{ "new": true }')
    expect(runQuery).toHaveBeenCalledTimes(1)
  })

  it('ignores a translation after the workspace leaves SQL mode', async () => {
    const tab = { id: 'first', mode: 'sql', sql: 'SELECT 1' }
    let resolveTranslation
    const runQuery = vi.fn()
    const running = runTranslatedSql(tab, {
      translate: () => new Promise(resolve => { resolveTranslation = resolve }),
      runQuery,
      runExplain: vi.fn(),
      explainVisible: () => false,
      isCurrent: candidate => candidate.mode === 'sql',
    })

    tab.mode = 'find'
    resolveTranslation({ filter: '{}', projection: '{}', sort: '{}' })
    await running

    expect(runQuery).not.toHaveBeenCalled()
  })
})
