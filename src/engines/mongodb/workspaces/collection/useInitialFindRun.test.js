import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useInitialFindRun } from './useInitialFindRun'

function restoredFind(fields = {}) {
  return {
    id: 'find-1',
    type: 'mongodb.find',
    needsInitialRun: true,
    filter: '{ status: "open" }',
    projection: '{ name: 1 }',
    sort: '{ createdAt: -1 }',
    skip: '2',
    limit: '25',
    ...fields,
  }
}

describe('useInitialFindRun', () => {
  it('runs an active restored find once and clears the marker before dispatch', () => {
    const workspace = restoredFind()
    const activeWorkspace = ref(workspace)
    const runQuery = vi.fn((candidate) => {
      expect(candidate.needsInitialRun).toBe(false)
    })

    useInitialFindRun(activeWorkspace, { runQuery })

    expect(runQuery).toHaveBeenCalledOnce()
    expect(runQuery).toHaveBeenCalledWith(workspace, {
      filter: '{"status":"open"}',
      projection: '{"name":{"$numberInt":"1"}}',
      sort: '{"createdAt":{"$numberInt":"-1"}}',
      skip: 2,
      limit: 25,
    })
    activeWorkspace.value = workspace
    expect(runQuery).toHaveBeenCalledOnce()
  })

  it('waits until an inactive restored find becomes active', async () => {
    const workspace = restoredFind()
    const activeWorkspace = ref({ id: 'quickstart', type: 'app.quickstart' })
    const runQuery = vi.fn()

    useInitialFindRun(activeWorkspace, { runQuery })
    expect(runQuery).not.toHaveBeenCalled()

    activeWorkspace.value = workspace
    await nextTick()
    expect(runQuery).toHaveBeenCalledOnce()
  })

  it.each(['mongodb.aggregate', 'mongodb.sql_to_mql'])(
    'does not automatically run %s workspaces',
    (type) => {
      const workspace = restoredFind({ type })
      const runQuery = vi.fn()

      useInitialFindRun(ref(workspace), { runQuery })

      expect(runQuery).not.toHaveBeenCalled()
      expect(workspace.needsInitialRun).toBe(true)
    },
  )

  it('preserves restored-query fallback parsing', () => {
    const workspace = restoredFind({
      filter: '{',
      projection: 'not valid',
      sort: '[',
      skip: null,
      limit: undefined,
    })
    const runQuery = vi.fn()

    useInitialFindRun(ref(workspace), { runQuery })

    expect(runQuery).toHaveBeenCalledWith(workspace, {
      filter: '{}',
      projection: '{}',
      sort: '{}',
      skip: 0,
      limit: NaN,
    })
  })
})
