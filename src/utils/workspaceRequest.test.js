import { describe, expect, it } from 'vitest'
import { beginWorkspaceRequest } from './workspaceRequest'

describe('beginWorkspaceRequest', () => {
  it('invalidates the older request on the same workspace and channel', () => {
    const workspace = {}
    const first = beginWorkspaceRequest(workspace, 'explain')
    const second = beginWorkspaceRequest(workspace, 'explain')

    expect(first.isCurrent()).toBe(false)
    expect(second.isCurrent()).toBe(true)
  })

  it('keeps request channels and workspaces independent', () => {
    const firstWorkspace = {}
    const secondWorkspace = {}
    const sql = beginWorkspaceRequest(firstWorkspace, 'sql')
    const explain = beginWorkspaceRequest(firstWorkspace, 'explain')
    const otherSql = beginWorkspaceRequest(secondWorkspace, 'sql')

    expect(sql.isCurrent()).toBe(true)
    expect(explain.isCurrent()).toBe(true)
    expect(otherSql.isCurrent()).toBe(true)
  })
})
