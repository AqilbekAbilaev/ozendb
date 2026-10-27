import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createResourceRef } from '../../../utils/resourceRef'

vi.mock('../../../stores/toast', () => ({ showToast: vi.fn() }))
vi.mock('../tabs', () => ({
  openCollectionTab: vi.fn(), openShellTab: vi.fn(), openIndexManagerTab: vi.fn(),
  openSchemaTab: vi.fn(), openSearchTab: vi.fn(), openCurrentOpsTab: vi.fn(), openExportSource: vi.fn(),
}))
vi.mock('../../../stores/modals', () => ({ openModal: vi.fn() }))
vi.mock('./useDbActions', () => ({ useDbActions: () => ({ pasteClipboard: vi.fn() }) }))
vi.mock('./useDbTransfer', () => ({
  useDbTransfer: () => ({ openImportWizard: vi.fn(), exportDatabase: vi.fn(), importDatabase: vi.fn() }),
}))

const { openShellTab, openCurrentOpsTab } = await import('../tabs')
const { openModal } = await import('../../../stores/modals')
const { useMongoActions } = await import('./actions')

const dbRef = (connId, db) => createResourceRef(connId, [{ kind: 'database', name: db }])
const collRef = (connId, db, coll) => createResourceRef(connId, [
  { kind: 'database', name: db }, { kind: 'collection', name: coll },
])

// What the shared dispatcher hands a handler for a right-clicked `orders` row.
const orders = collRef('c1', 'shop', 'orders')
const ordersCtx = { label: 'orders', connectionName: 'Sales' }
const run = (action, ref = orders, ctx = ordersCtx) => useMongoActions()[action].run(ref, ctx)

beforeEach(() => {
  vi.clearAllMocks()
})

// Every entry point hands the handlers a ResourceRef; each handler cuts it to the level
// its action needs before passing it on, so a deeper row acts on its own ancestor.
describe('MongoDB actions take a ResourceRef', () => {
  it('opens a database tool for the database of a right-clicked collection', () => {
    run('file:intellishell')
    expect(openShellTab).toHaveBeenCalledWith({ resource: dbRef('c1', 'shop'), connectionName: 'Sales' })
  })

  it('gives a connection-scoped tool no database or collection to filter on', () => {
    run('db:current_ops')
    expect(openCurrentOpsTab).toHaveBeenCalledWith({
      resource: createResourceRef('c1'), connectionName: 'Sales',
    })
  })

  it('opens a collection-level modal with the collection\'s ref', () => {
    run('coll:stats')
    expect(openModal).toHaveBeenCalledWith('stats', {
      resource: createResourceRef('c1', [
        { kind: 'database', name: 'shop' },
        { kind: 'collection', name: 'orders' },
      ]),
      connectionName: 'Sales',
    })
  })

  // Every level now goes through the same conversion, so a modal's payload is its ref and
  // the connection's display name — never the flat fields (#193).
  it('opens a registry modal with exactly its level\'s target, at every level', () => {
    for (const action of ['coll:validator', 'coll:history', 'coll:mapreduce', 'coll:drop', 'coll:rename', 'coll:duplicate']) {
      run(action)
    }
    for (const [, payload] of openModal.mock.calls) {
      expect(Object.keys(payload).sort()).toEqual(['connectionName', 'resource'])
    }
  })

  it('opens a connection-level modal with the connection\'s ref and its name', () => {
    run('file:server_status')
    expect(openModal).toHaveBeenCalledWith('serverStatus', {
      resource: createResourceRef('c1'), connectionName: 'Sales',
    })
  })

  it('opens the shared server info modal with its kind and title beside the ref', () => {
    run('conn:host_info', createResourceRef('c1'), { connectionName: 'Sales' })
    expect(openModal).toHaveBeenCalledWith('serverInfo', {
      resource: createResourceRef('c1'), connectionName: 'Sales', kind: 'host', title: 'Host Info',
    })
  })

  it('opens a database-level modal with the database\'s ref', () => {
    run('db:database_stats')
    expect(openModal).toHaveBeenCalledWith('dbStats', {
      resource: createResourceRef('c1', [{ kind: 'database', name: 'shop' }]), connectionName: 'Sales',
    })
  })

  it('seeds Add View Here with the clicked collection beside its database\'s ref', () => {
    run('coll:add_view')
    expect(openModal).toHaveBeenCalledWith('addView', {
      resource: createResourceRef('c1', [{ kind: 'database', name: 'shop' }]),
      connectionName: 'Sales', source: 'orders',
    })
  })
})
