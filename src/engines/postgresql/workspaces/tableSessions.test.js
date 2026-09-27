import { describe, it, expect, vi } from 'vitest'
import { tableSession, dropTableSession } from './tableSessions.js'

describe('tableSession', () => {
  it('builds a tab\'s state once and hands the same one back on every switch', () => {
    const build = vi.fn(() => ({ rows: [] }))
    const first = tableSession('t1', build)
    expect(tableSession('t1', build)).toBe(first)
    expect(build).toHaveBeenCalledTimes(1)
    dropTableSession('t1')
  })

  it('forgets a closed tab, so reopening one builds fresh state', () => {
    const first = tableSession('t2', () => ({}))
    dropTableSession('t2')
    expect(tableSession('t2', () => ({}))).not.toBe(first)
    dropTableSession('t2')
  })
})
