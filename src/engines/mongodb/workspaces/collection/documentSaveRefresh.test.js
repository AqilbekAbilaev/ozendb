import { describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(), emit: vi.fn() }))
vi.mock('../../api/queries', () => ({ runFind: vi.fn() }))

import { listen } from '@tauri-apps/api/event'
import { runFind } from '../../api/queries'
import { refreshFindWorkspacesAfterDocumentSave } from './documentSaveRefresh'
import { createResourceRef } from '../../../../utils/resourceRef'
import { tabs } from '../../../../stores/tabs'
import { ENGINES } from '../../../index.js'

// A Find on c1/shop/orders; any level can be swapped to build an unrelated one.
const matchingFind = ({ hasRun = true, connectionId = 'c1', dbName = 'shop', collectionName = 'orders', ...fields } = {}) => ({
  id: 'find-1',
  type: 'mongodb.find',
  target: createResourceRef(connectionId, [
    { kind: 'database', name: dbName }, { kind: 'collection', name: collectionName },
  ]),
  state: {
    query: { filter: '{ status: "open" }', projection: '{ total: 1 }', sort: '{ createdAt: -1 }', skip: '2', limit: '25' },
  },
  runtime: { hasRun },
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

describe('MongoDB\'s startup hook', () => {
  it('reruns a matching Find when the pop-out editor saves a document', () => {
    runFind.mockResolvedValue({ documents: [], elapsedMs: 3 })
    tabs.value = [matchingFind({ dbName: 'shop ü', collectionName: 'or.ders' })]

    ENGINES.mongodb.start()
    const [name, handler] = listen.mock.calls[0]
    handler({ event: name, payload: { connId: 'c1', db: 'shop ü', coll: 'or.ders' } })

    expect(name).toBe('document-saved')
    expect(runFind).toHaveBeenCalledWith(
      { connectionId: 'c1', database: 'shop ü', collection: 'or.ders' },
      { filter: '{"status":"open"}', projection: '{"total":{"$numberInt":"1"}}', sort: '{"createdAt":{"$numberInt":"-1"}}', skip: 2, limit: 25 },
      expect.any(String),
    )
  })
})
