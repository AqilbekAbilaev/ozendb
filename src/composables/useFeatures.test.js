import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createResourceRef } from '../utils/resourceRef'

// The tab store builds its module-scope Quickstart through a definition, so the
// registry must be populated before any import that evaluates it — including this
// composable, which imports the store. Static imports run before this file's body,
// hence the dynamic imports below.
import { registerWorkspaceDefinitions } from '../workspaces/registerDefinitions'
registerWorkspaceDefinitions()

const applyColorTag = vi.hoisted(() => vi.fn())
vi.mock('../stores/toast', () => ({ showToast: vi.fn() }))
vi.mock('../stores/tabCreators', () => ({
  openCollectionTab: vi.fn(), openShellTab: vi.fn(), openIndexManagerTab: vi.fn(),
  openSqlTab: vi.fn(), openSchemaTab: vi.fn(), openSearchTab: vi.fn(),
  openCurrentOpsTab: vi.fn(), openExportSource: vi.fn(),
  openPostgresQuery: vi.fn(), openPostgresTable: vi.fn(),
}))
vi.mock('../stores/modals', () => ({ openModal: vi.fn() }))
vi.mock('./useDbActions', () => ({ useDbActions: () => ({ pasteClipboard: vi.fn() }) }))
vi.mock('./useNodeTags', () => ({ useNodeTags: () => ({ applyColorTag }) }))
vi.mock('./useDbTransfer', () => ({
  useDbTransfer: () => ({ openImportWizard: vi.fn(), exportDatabase: vi.fn(), importDatabase: vi.fn() }),
}))

const { tabs, activeTabId } = await import('../stores/tabs')
const { showToast } = await import('../stores/toast')
const { openCollectionTab, openShellTab, openSqlTab, openPostgresQuery, openSearchTab, openCurrentOpsTab } = await import('../stores/tabCreators')
const { openModal } = await import('../stores/modals')
const { useFeatures, UNBUILT_ACTIONS } = await import('./useFeatures')
const { MENU_ALIASES } = await import('./useAppMenuActions')
const { MENUS } = await import('../constants/contextMenus')
const { PG_MENUS, PG_ACTIONS } = await import('../engines/postgresql/tree/contextMenus')
const { contextMenu } = await import('../stores/contextMenu')
const { treeSelection, setTreeSelection } = await import('../stores/connectionNavigation')

vi.mock('../appApi/connections', () => ({
  disconnect: vi.fn(() => Promise.resolve()),
}))

const { disconnect } = await import('../appApi/connections')
vi.mock('../stores/connectionData', () => ({
  refreshConnectionResources: vi.fn(), clearConnectionResources: vi.fn(),
}))
const { refreshConnectionResources } = await import('../stores/connectionData')
vi.mock('../appApi/connectionState', () => ({ setConnectionOpen: vi.fn() }))
const {
  openConnections, addOpenConnection, resetOpenConnections,
} = await import('../stores/openConnections')

// A minimal harness: every slice useFeatures wires is mocked above and only the tab
// store is real. The tested surface is the disconnect paths — which tabs survive,
// whether disposal runs, and the active-tab fallback — plus toolbar routing.
function makeFeatures() {
  return useFeatures({ menuTarget: vi.fn() })
}

// A resource-scoped tab shaped like the real workspaces: long identity keys for
// collection/shell kinds, short aliases for tool kinds, and always the canonical
// target that containment is read from.
const tab = (id, connId, db, coll, kind = 'collection') => {
  const segments = []
  if (db) segments.push({ kind: 'database', name: db })
  if (coll) segments.push({ kind: 'collection', name: coll })
  return {
    id, type: 'mongodb.' + (kind === 'shell' ? 'shell' : kind === 'indexes' ? 'indexes' : 'find'),
    connectionId: connId, connectionName: 'Sales', dbName: db, collectionName: coll,
    connId, connName: 'Sales', collName: coll,
    target: createResourceRef(connId, segments),
  }
}

const dbRef = (connId, db) => createResourceRef(connId, [{ kind: 'database', name: db }])
const collRef = (connId, db, coll) => createResourceRef(connId, [
  { kind: 'database', name: db }, { kind: 'collection', name: coll },
])

const quickstart = { id: 'q', type: 'app.quickstart', title: 'Quickstart' }

function seedStore(arr, activeId) {
  tabs.value = arr
  activeTabId.value = activeId
}

beforeEach(() => {
  vi.clearAllMocks()
  refreshConnectionResources.mockReset().mockResolvedValue([])
})

describe('resource refresh actions', () => {
  it('refreshes the selected connection without a tree refresh method', async () => {
    await makeFeatures().runFeature('node:refresh', createResourceRef('c1'))
    expect(refreshConnectionResources).toHaveBeenCalledWith('c1')
    expect(showToast).toHaveBeenCalledWith('Refreshed')
  })

  it('reports selected refresh failure without rejecting', async () => {
    refreshConnectionResources.mockRejectedValue({ code: 'network', message: 'offline' })
    await makeFeatures().runFeature('node:refresh', createResourceRef('c1'))
    expect(showToast).toHaveBeenCalledWith("Refresh failed: Can't reach the server")
  })

  it('refreshes every open connection even if one fails', async () => {
    refreshConnectionResources.mockRejectedValueOnce('offline')
    resetOpenConnections()
    addOpenConnection({ id: 'c1' })
    addOpenConnection({ id: 'c2' })
    const features = makeFeatures()
    await features.runFeature('view:refresh_all', null)
    expect(refreshConnectionResources.mock.calls).toEqual([['c1'], ['c2']])
    expect(showToast).toHaveBeenCalledWith('Refreshed 1 connection, 1 failed')
  })
})

// The registry lives in the store, so these paths take no sidebar component at all —
// makeFeatures() passes an empty stub and they must still work.
describe('disconnect paths read the registry from the store', () => {
  beforeEach(() => {
    resetOpenConnections()
  })

  it('disconnects one connection without touching the sidebar component', async () => {
    addOpenConnection({ id: 'c1', name: 'One' })
    addOpenConnection({ id: 'c2', name: 'Two' })
    await makeFeatures().runFeature('conn:disconnect', createResourceRef('c1'), { label: 'One' })
    expect(disconnect).toHaveBeenCalledWith('c1')
    expect(openConnections.value.map(c => c.id)).toEqual(['c2'])
  })

  it('disconnects every other connection, keeping the named one', async () => {
    addOpenConnection({ id: 'c1', name: 'One' })
    addOpenConnection({ id: 'c2', name: 'Two' })
    addOpenConnection({ id: 'c3', name: 'Three' })
    await makeFeatures().runFeature('conn:disconnect_others', createResourceRef('c1'))
    expect(openConnections.value.map(c => c.id)).toEqual(['c1'])
  })

  it('disconnects all of them', async () => {
    addOpenConnection({ id: 'c1', name: 'One' })
    addOpenConnection({ id: 'c2', name: 'Two' })
    await makeFeatures().runFeature('conn:disconnect_all', null)
    expect(openConnections.value).toEqual([])
  })
})

describe('disconnect paths close affected workspaces through the store', () => {
  it('disconnectOne closes every tab scoped into that connection and keeps the rest', async () => {
    seedStore([
      quickstart,
      tab('f', 'c1', 'shop', 'orders'),
      tab('sh', 'c1', 'shop', null, 'shell'),
      tab('ix', 'c1', 'shop', 'orders', 'indexes'),
      tab('f2', 'c2', 'other', 'items'),
    ], 'f')
    resetOpenConnections()
    addOpenConnection({ id: 'c1' })
    const features = makeFeatures()
    await features.runFeature('conn:disconnect', createResourceRef('c1'), { label: 'Sales', connectionName: 'Sales' })
    expect(disconnect).toHaveBeenCalledWith('c1')
    const ids = tabs.value.map(t => t.id)
    expect(ids).not.toContain('f')
    expect(ids).not.toContain('sh')
    expect(ids).not.toContain('ix')
    expect(ids).toEqual(['q', 'f2'])
  })

  it('disconnectOthers keeps tabs under the surviving connection only', async () => {
    seedStore([
      quickstart,
      tab('f', 'c1', 'shop', 'orders'),
      tab('sh', 'c1', 'shop', null, 'shell'),
      tab('f2', 'c2', 'other', 'items'),
      tab('ix', 'c2', 'other', 'items', 'indexes'),
    ], 'sh')
    resetOpenConnections()
    addOpenConnection({ id: 'c1' })
    addOpenConnection({ id: 'c2' })
    const features = makeFeatures()
    await features.runFeature('conn:disconnect_others', createResourceRef('c1'), { connectionName: 'Sales' })
    expect(disconnect).toHaveBeenCalledWith('c2')
    const ids = tabs.value.map(t => t.id)
    expect(ids).toEqual(['q', 'f', 'sh'])
    expect(activeTabId.value).toBe('sh')
  })

  it('disconnectAll keeps only resource-less workspaces', async () => {
    seedStore([
      quickstart,
      tab('f', 'c1', 'shop', 'orders'),
      tab('sh', 'c1', 'shop', null, 'shell'),
      tab('f2', 'c2', 'other', 'items'),
    ], 'f')
    resetOpenConnections()
    addOpenConnection({ id: 'c1' })
    addOpenConnection({ id: 'c2' })
    const features = makeFeatures()
    await features.runFeature('conn:disconnect_all', null)
    expect(disconnect).toHaveBeenCalledWith('c1')
    expect(disconnect).toHaveBeenCalledWith('c2')
    expect(tabs.value.map(t => t.id)).toEqual(['q'])
    expect(activeTabId.value).toBe('q')
  })
})

describe('global toolbar routing', () => {
  it('routes a database tool through the active tab', () => {
    seedStore([tab('f', 'c1', 'shop', 'orders')], 'f')
    const features = makeFeatures()

    features.handleTool('shell')

    expect(openShellTab).toHaveBeenCalledWith({ resource: dbRef('c1', 'shop'), connectionName: 'Sales' })
  })

  it('opens the collection explicitly resolved by the native menu', () => {
    const target = { resource: collRef('c2', 'warehouse', 'stock'), connectionName: 'Sales' }
    const features = makeFeatures()

    features.handleTool('collection', target)

    expect(openCollectionTab).toHaveBeenCalledWith(target)
  })

  // With no explicit target, the toolbar's Collection button opens whatever is
  // highlighted in the sidebar — and clears that highlight, since the opened tab's
  // own active-collection highlight takes over.
  it('opens the sidebar selection when no target is given', () => {
    setTreeSelection({ resource: collRef('c1', 'shop', 'orders'), connectionName: 'Sales', engine: 'mongodb' })
    makeFeatures().handleTool('collection')

    expect(openCollectionTab).toHaveBeenCalledWith({ resource: collRef('c1', 'shop', 'orders'), connectionName: 'Sales' })
    expect(treeSelection.value).toBeNull()
  })

  it('guides the user when nothing in the sidebar is a collection', () => {
    setTreeSelection({ resource: dbRef('c1', 'shop'), connectionName: 'Sales', engine: 'mongodb' })
    makeFeatures().handleTool('collection')

    expect(openCollectionTab).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Select a collection in the sidebar first')
  })
})

// Every entry point hands the handlers a ResourceRef; each handler cuts it to the level
// its action needs before passing it on, so a deeper row acts on its own ancestor.
describe('feature nodes arrive as a ResourceRef', () => {
  const ordersRow = {
    type: 'collection', x: 0, y: 0, label: 'orders',
    nodeData: { resource: collRef('c1', 'shop', 'orders'), connectionName: 'Sales' },
  }

  it('opens a database tool for the database of a right-clicked collection', () => {
    contextMenu.value = ordersRow
    makeFeatures().handleContextAction('file:intellishell')
    expect(openShellTab).toHaveBeenCalledWith({ resource: dbRef('c1', 'shop'), connectionName: 'Sales' })
  })

  it('gives a connection-scoped tool no database or collection to filter on', () => {
    contextMenu.value = ordersRow
    makeFeatures().handleContextAction('db:current_ops')
    expect(openCurrentOpsTab).toHaveBeenCalledWith({
      resource: createResourceRef('c1'), connectionName: 'Sales',
    })
  })

  it('opens a collection-level modal with the collection\'s ref', () => {
    contextMenu.value = ordersRow
    makeFeatures().handleContextAction('coll:stats')
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
    contextMenu.value = ordersRow
    const features = makeFeatures()
    for (const action of ['coll:validator', 'coll:history', 'coll:mapreduce', 'coll:drop', 'coll:rename', 'coll:duplicate']) {
      features.handleContextAction(action)
      contextMenu.value = ordersRow
    }
    for (const [, payload] of openModal.mock.calls) {
      expect(Object.keys(payload).sort()).toEqual(['connectionName', 'resource'])
    }
  })

  it('opens a connection-level modal with the connection\'s ref and its name', () => {
    contextMenu.value = ordersRow
    makeFeatures().handleContextAction('file:server_status')
    expect(openModal).toHaveBeenCalledWith('serverStatus', {
      resource: createResourceRef('c1'), connectionName: 'Sales',
    })
  })

  it('opens the shared server info modal with its kind and title beside the ref', () => {
    makeFeatures().runFeature('conn:host_info', createResourceRef('c1'), { connectionName: 'Sales' })
    expect(openModal).toHaveBeenCalledWith('serverInfo', {
      resource: createResourceRef('c1'), connectionName: 'Sales', kind: 'host', title: 'Host Info',
    })
  })

  it('opens a database-level modal with the database\'s ref', () => {
    contextMenu.value = ordersRow
    makeFeatures().handleContextAction('db:database_stats')
    expect(openModal).toHaveBeenCalledWith('dbStats', {
      resource: createResourceRef('c1', [{ kind: 'database', name: 'shop' }]), connectionName: 'Sales',
    })
  })

  it('seeds Add View Here with the clicked collection beside its database\'s ref', () => {
    contextMenu.value = ordersRow
    makeFeatures().handleContextAction('coll:add_view')
    expect(openModal).toHaveBeenCalledWith('addView', {
      resource: createResourceRef('c1', [{ kind: 'database', name: 'shop' }]),
      connectionName: 'Sales', source: 'orders',
    })
  })

  it('guides the user when the node is too shallow for the action', () => {
    makeFeatures().runFeature('coll:stats', createResourceRef('c1', [{ kind: 'database', name: 'shop' }]))
    expect(openModal).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Open a collection first')
  })

  it('runs a native menu action on the target it resolves', () => {
    const menuTarget = vi.fn(() => ({ resource: dbRef('c1', 'shop'), connectionName: 'Sales' }))
    useFeatures({ menuTarget }).menuNode('file:search')
    expect(openSearchTab).toHaveBeenCalledWith({
      resource: createResourceRef('c1', [{ kind: 'database', name: 'shop' }]), connectionName: 'Sales',
    })
  })

  it('guides the user when the native menu has nothing deep enough', () => {
    const menuTarget = vi.fn(() => ({ resource: createResourceRef('c1'), connectionName: 'Sales' }))
    useFeatures({ menuTarget }).menuNode('coll:stats')
    expect(openModal).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('Open a collection first')
  })
})

describe('color tag persistence', () => {
  it('shows a normalized error when saving a tag fails', async () => {
    contextMenu.value = {
      type: 'collection',
      nodeData: { resource: collRef('c1', 'db', 'orders'), connectionName: 'Sales' },
    }
    applyColorTag.mockRejectedValue({ code: 'command', message: 'disk full' })
    const features = makeFeatures()

    await features.handleContextAction('node:color:red')

    expect(showToast).toHaveBeenCalledWith('Could not save color tag: disk full')
  })
})

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

describe('handleTool falling back to the active workspace', () => {
  beforeEach(() => {
    tabs.value = [toolTab('s1', 'c1', 'shop', 'orders', 'schema')]
    activeTabId.value = 's1'
  })

  // The toolbar passes no target, so the active workspace is it, read through its
  // target rather than whichever identity fields it happens to carry.
  it('opens IntelliShell for the database a Schema tab is scoped to', () => {
    makeFeatures().handleTool('shell')
    expect(openShellTab).toHaveBeenCalledWith({ resource: dbRef('c1', 'shop'), connectionName: 'Sales' })
    expect(showToast).not.toHaveBeenCalled()
  })

  it('opens SQL for the collection a Schema tab is scoped to', () => {
    makeFeatures().handleTool('sql')
    expect(openSqlTab).toHaveBeenCalledWith({ resource: collRef('c1', 'shop', 'orders'), connectionName: 'Sales' })
  })

  // Current Operations is connection-scoped: its dbName/collName are filters, so a
  // database-scoped tool must not act on them.
  it('does not treat Current Operations filters as a database', () => {
    tabs.value = [toolTab('o1', 'c1', 'shop', 'orders', 'currentOps')]
    activeTabId.value = 'o1'
    makeFeatures().handleTool('shell')
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
    makeFeatures().handleTool('shell')
    expect(openShellTab).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalled()
  })
})

// The dispatcher is keyed on action ids, never on the labels menus show, so a renamed
// or translated label can't break an action. Every id a menu offers must be
// dispatchable, and every one that is not must be an acknowledged placeholder.
describe('context menu coverage', () => {
  // A `sub` item only opens a flyout; its `subItems` are the real actions. The tab
  // menu is excluded because handleContextAction routes it to the tab store before
  // runFeature ever sees it.
  function actionsIn(items) {
    const out = []
    for (const item of items) {
      if (item.sep) continue
      if (item.subItems) out.push(...item.subItems.map((sub) => sub.value))
      if (item.sub) continue
      out.push(item.value)
    }
    return out
  }
  const offered = [...new Set(
    Object.entries(MENUS).filter(([type]) => type !== 'tab').flatMap(([, items]) => actionsIn(items)),
  )]

  it('scrapes a plausible number of actions, so a silently-empty check cannot pass', () => {
    expect(offered.length).toBeGreaterThan(30)
  })

  it('gives every item an id, so no label is ever the action', () => {
    const all = [...Object.values(MENUS), ...Object.values(PG_MENUS)].flatMap(actionsIn)
    expect(all.filter((id) => typeof id !== 'string' || !id.includes(':'))).toEqual([])
  })

  it('can dispatch every action the menus offer', () => {
    const { knownActions } = makeFeatures()
    const orphans = offered.filter(a => !knownActions.has(a) && !UNBUILT_ACTIONS.has(a))
    expect(orphans).toEqual([])
  })

  it('can dispatch every action the PostgreSQL menus offer', () => {
    const { knownActions } = makeFeatures()
    const pgOffered = Object.values(PG_MENUS).flatMap(actionsIn)
    expect(pgOffered.filter(a => !PG_ACTIONS[a] && !knownActions.has(a))).toEqual([])
  })

  it('runs a PostgreSQL node\'s own action, not the MongoDB one of the same level', () => {
    const node = { connId: 'p1', connName: 'Payments PG', engine: 'postgresql', database: 'payments' }
    contextMenu.value = { type: 'pg:database', x: 0, y: 0, label: 'payments', nodeData: node, items: PG_MENUS.database }
    makeFeatures().handleContextAction('pg:new_sql')
    expect(openPostgresQuery).toHaveBeenCalledWith({ connectionId: 'p1', connectionName: 'Payments PG', database: 'payments' })
  })

  // A PostgreSQL row offers the shared Refresh; it acts on the row's connection.
  it('refreshes the connection of a right-clicked PostgreSQL row', async () => {
    const node = {
      connId: 'p1', connName: 'Payments PG', engine: 'postgresql', database: 'payments', schema: 'public',
      resource: createResourceRef('p1', [{ kind: 'database', name: 'payments' }, { kind: 'schema', name: 'public' }]),
    }
    contextMenu.value = { type: 'pg:schema', x: 0, y: 0, label: 'public', nodeData: node, items: PG_MENUS.schema }
    await makeFeatures().handleContextAction('node:refresh')
    expect(refreshConnectionResources).toHaveBeenCalledWith('p1')
  })

  it('keeps no placeholder for an action that is in fact implemented', () => {
    const { knownActions } = makeFeatures()
    expect([...UNBUILT_ACTIONS.keys()].filter(a => knownActions.has(a))).toEqual([])
  })

  it('reports an unknown action as a fault instead of an unbuilt feature', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    makeFeatures().runFeature('nope:not_a_feature', createResourceRef('c1'))
    expect(showToast).toHaveBeenCalledWith('Could not run "nope:not_a_feature"')
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('still says "coming soon", by name, for the acknowledged placeholders', () => {
    makeFeatures().runFeature('conn:export_uri', createResourceRef('c1'))
    expect(showToast).toHaveBeenCalledWith('Export URI… — coming to OzenDB')
  })
})

// The native menu items that used to reach a feature through a hand-written
// `menuNode('Label', level)` arm now reach it by id. Each must still name one.
describe('native menu ids that run features', () => {
  const NODE_ITEMS = [
    'file:server_status', 'file:server_charts', 'file:server_build', 'file:add_database',
    'db:database_stats', 'db:current_ops', 'db:profiler', 'db:add_collection', 'db:add_database',
    'db:add_view', 'db:export', 'db:import', 'db:add_bucket', 'db:manage_users', 'db:manage_roles',
    'db:functions', 'db:copy_database', 'db:copy_all', 'db:paste', 'db:paste_database',
    'db:drop_database', 'db:collection_stats', 'gridfs:open',
    'coll:add_view', 'coll:validator', 'coll:mapreduce', 'coll:copy', 'coll:aggregation', 'coll:add_index',
    'coll:stats', 'coll:schema', 'coll:history', 'coll:rename', 'coll:duplicate', 'coll:drop',
  ]

  it('resolves each, directly or through an alias, to a dispatchable feature', () => {
    const { knownActions } = makeFeatures()
    expect(NODE_ITEMS.filter((id) => !knownActions.has(MENU_ALIASES[id] ?? id))).toEqual([])
  })

  it('aliases only to features that exist', () => {
    const { knownActions } = makeFeatures()
    expect(Object.values(MENU_ALIASES).filter((id) => !knownActions.has(id))).toEqual([])
  })
})
