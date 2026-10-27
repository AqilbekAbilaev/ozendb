import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createResourceRef } from '../../utils/resourceRef'

// The tab store builds its module-scope Quickstart through a definition, so the
// registry must be populated before any import that evaluates it. Static imports run
// before this file's body, hence the dynamic imports below.
import { registerWorkspaceDefinitions } from '../../workspaces/registerDefinitions'
registerWorkspaceDefinitions()

vi.mock('../../stores/toast', () => ({ showToast: vi.fn() }))
vi.mock('./tabs', () => ({
  openCollectionTab: vi.fn(), openShellTab: vi.fn(), openIndexManagerTab: vi.fn(),
  openSqlTab: vi.fn(), openSchemaTab: vi.fn(), openSearchTab: vi.fn(),
  openCurrentOpsTab: vi.fn(), openExportSource: vi.fn(),
}))
vi.mock('../../stores/modals', () => ({ openModal: vi.fn() }))
vi.mock('./tree/useDbActions', () => ({ useDbActions: () => ({ pasteClipboard: vi.fn() }) }))
vi.mock('./tree/useDbTransfer', () => ({
  useDbTransfer: () => ({ openImportWizard: vi.fn(), exportDatabase: vi.fn(), importDatabase: vi.fn() }),
}))

const { tabs, activeTabId } = await import('../../stores/tabs')
const { showToast } = await import('../../stores/toast')
const { openCollectionTab, openShellTab, openSqlTab } = await import('./tabs')
const { treeSelection, setTreeSelection } = await import('../../stores/connectionNavigation')
const { runMongoTool } = await import('./toolbarActions')

const dbRef = (connId, db) => createResourceRef(connId, [{ kind: 'database', name: db }])
const collRef = (connId, db, coll) => createResourceRef(connId, [
  { kind: 'database', name: db }, { kind: 'collection', name: coll },
])

// A tool workspace as toolDefinitions builds it: the long spelling, and a target at the
// tool's own scope. Current Operations is connection-scoped; its dbName and collName are
// filters, and only the target says so.
const toolTab = (id, connId, db, coll, kind) => {
  const connectionScoped = kind === 'currentOps'
  return {
    id, type: connectionScoped ? 'mongodb.current_operations' : 'mongodb.' + kind,
    connectionId: connId, connectionName: 'Sales', dbName: db,
    ...(connectionScoped ? { collName: coll } : { collectionName: coll }),
    target: createResourceRef(connId, connectionScoped ? [] : [
      { kind: 'database', name: db }, { kind: 'collection', name: coll },
    ]),
  }
}

let runFeature
beforeEach(() => {
  vi.clearAllMocks()
  runFeature = vi.fn()
  setTreeSelection(null)
})

describe('runMongoTool', () => {
  it('leaves a tool that isn\'t MongoDB\'s to the next engine', () => {
    expect(runMongoTool('pgTable', null, runFeature)).toBe(false)
    expect(runFeature).not.toHaveBeenCalled()
  })

  it('opens the collection explicitly resolved by the native menu', () => {
    const target = { resource: collRef('c2', 'warehouse', 'stock'), connectionName: 'Sales' }

    expect(runMongoTool('collection', target, runFeature)).toBe(true)

    expect(openCollectionTab).toHaveBeenCalledWith(target)
  })

  // With no explicit target, the toolbar's Collection button opens whatever is
  // highlighted in the sidebar — and clears that highlight, since the opened tab's
  // own active-collection highlight takes over.
  it('opens the sidebar selection when no target is given', () => {
    setTreeSelection({ resource: collRef('c1', 'shop', 'orders'), connectionName: 'Sales', engine: 'mongodb' })
    runMongoTool('collection', null, runFeature)

    expect(openCollectionTab).toHaveBeenCalledWith({ resource: collRef('c1', 'shop', 'orders'), connectionName: 'Sales' })
    expect(treeSelection.value).toBeNull()
  })

  it('guides the user when nothing in the sidebar is a collection', () => {
    setTreeSelection({ resource: dbRef('c1', 'shop'), connectionName: 'Sales', engine: 'mongodb' })
    runMongoTool('collection', null, runFeature)

    expect(openCollectionTab).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Select a collection in the sidebar first')
  })

  it('runs an aliased tool as its action, through the shared dispatcher', () => {
    const target = { resource: collRef('c1', 'shop', 'orders'), connectionName: 'Sales' }
    runMongoTool('schema', target, runFeature)
    expect(runFeature).toHaveBeenCalledWith('coll:schema', target.resource, { connectionName: 'Sales' })
  })
})

describe('runMongoTool falling back to the active workspace', () => {
  beforeEach(() => {
    tabs.value = [toolTab('s1', 'c1', 'shop', 'orders', 'schema')]
    activeTabId.value = 's1'
  })

  // The toolbar passes no target, so the active workspace is it, read through its
  // target rather than whichever identity fields it happens to carry.
  it('opens IntelliShell for the database a Schema tab is scoped to', () => {
    runMongoTool('shell', null, runFeature)
    expect(openShellTab).toHaveBeenCalledWith({ resource: dbRef('c1', 'shop'), connectionName: 'Sales' })
    expect(showToast).not.toHaveBeenCalled()
  })

  it('opens SQL for the collection a Schema tab is scoped to', () => {
    runMongoTool('sql', null, runFeature)
    expect(openSqlTab).toHaveBeenCalledWith({ resource: collRef('c1', 'shop', 'orders'), connectionName: 'Sales' })
  })

  // Current Operations is connection-scoped: its dbName/collName are filters, so a
  // database-scoped tool must not act on them.
  it('does not treat Current Operations filters as a database', () => {
    tabs.value = [toolTab('o1', 'c1', 'shop', 'orders', 'currentOps')]
    activeTabId.value = 'o1'
    runMongoTool('shell', null, runFeature)
    expect(openShellTab).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalled()
  })

  // A PostgreSQL SQL tab's target is database-deep, the same depth as a MongoDB
  // database: only its engine says it names nothing a MongoDB tool can act on.
  it('does not treat a PostgreSQL tab as a MongoDB database', () => {
    tabs.value = [{
      id: 'p1', type: 'postgresql.query', engine: 'postgresql',
      connectionId: 'pg1', connectionName: 'Payments', database: 'app',
      target: createResourceRef('pg1', [{ kind: 'database', name: 'app' }]),
    }]
    activeTabId.value = 'p1'
    runMongoTool('shell', null, runFeature)
    expect(openShellTab).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalled()
  })
})
