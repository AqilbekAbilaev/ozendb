import { describe, expect, it, vi } from 'vitest'
import { refreshFindWorkspacesAfterDocumentSave } from './documentSaveRefresh'

const matchingFind = (fields = {}) => ({
  id: 'find-1',
  type: 'mongodb.find',
  hasRun: true,
  connectionId: 'c1',
  dbName: 'shop',
  collectionName: 'orders',
  filter: '{ status: "open" }',
  projection: '{ total: 1 }',
  sort: '{ createdAt: -1 }',
  skip: '2',
  limit: '25',
  ...fields,
})

describe('refreshFindWorkspacesAfterDocumentSave', () => {
  it('refreshes a matching previously-run Find with its current query', () => {
    const runQuery = vi.fn()

    refreshFindWorkspacesAfterDocumentSave(
      [matchingFind()],
      { connId: 'c1', db: 'shop', coll: 'orders' },
      runQuery,
    )

    expect(runQuery).toHaveBeenCalledWith('find-1', {
      filter: '{"status":"open"}',
      projection: '{"total":{"$numberInt":"1"}}',
      sort: '{"createdAt":{"$numberInt":"-1"}}',
      skip: 2,
      limit: 25,
    })
  })

  it('ignores unrun, non-Find, and unrelated workspaces', () => {
    const runQuery = vi.fn()
    const workspaces = [
      matchingFind({ id: 'unrun', hasRun: false }),
      matchingFind({ id: 'aggregate', type: 'mongodb.aggregate' }),
      matchingFind({ id: 'sql', type: 'mongodb.sql_to_mql' }),
      matchingFind({ id: 'connection', connectionId: 'c2' }),
      matchingFind({ id: 'database', dbName: 'archive' }),
      matchingFind({ id: 'collection', collectionName: 'customers' }),
    ]

    refreshFindWorkspacesAfterDocumentSave(
      workspaces,
      { connId: 'c1', db: 'shop', coll: 'orders' },
      runQuery,
    )

    expect(runQuery).not.toHaveBeenCalled()
  })

  it('ignores a null event payload', () => {
    const runQuery = vi.fn()

    expect(() => refreshFindWorkspacesAfterDocumentSave(
      [matchingFind()],
      null,
      runQuery,
    )).not.toThrow()
    expect(runQuery).not.toHaveBeenCalled()
  })
})
