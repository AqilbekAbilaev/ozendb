import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { createResourceRef } from '../utils/resourceRef'

// The tab store builds its module-scope Quickstart through a definition, so the
// registry must be populated before any import that evaluates it — including this
// composable, which imports the store. Static imports run before this file's body,
// hence the dynamic imports below.
import { registerWorkspaceDefinitions } from '../workspaces/registerDefinitions'
registerWorkspaceDefinitions()

const { tabs, activeTabId } = await import('../stores/tabs')
const { useFeatures } = await import('./useFeatures')

vi.mock('../engines/mongodb/api/connections', () => ({
  disconnect: vi.fn(() => Promise.resolve()),
}))

const { disconnect } = await import('../engines/mongodb/api/connections')

// A minimal harness: useFeatures' dependencies are injected, so every other slice is
// a stub and only the tab store is real. The tested surface is the disconnect paths:
// which tabs survive, whether disposal runs, and the active-tab fallback.
function makeFeatures(connectionRef, overrides = {}) {
  return useFeatures({
    contextMenu: ref(null),
    connectionTreeRef: ref(connectionRef),
    dbClipboard: ref(null),
    modals: { openModal: vi.fn() },
    dbActions: { pasteClipboard: vi.fn() },
    showToast: vi.fn(),
    applyColorTag: vi.fn(),
    menuTarget: vi.fn(),
    handleTabAction: vi.fn(),
    openCollectionTab: vi.fn(), openShellTab: vi.fn(), openIndexManagerTab: vi.fn(),
    openSqlTab: vi.fn(), openSchemaTab: vi.fn(), openSearchTab: vi.fn(),
    openCurrentOpsTab: vi.fn(), openExportSource: vi.fn(), openImportWizard: vi.fn(),
    exportDatabase: vi.fn(), importDatabase: vi.fn(),
    ...overrides,
  })
}

// A resource-scoped tab shaped like the real workspaces: long identity keys for
// collection/shell kinds, short aliases for tool kinds, and always the canonical
// target that containment is read from.
const tab = (id, connId, db, coll, kind = 'collection') => {
  const segments = []
  if (db) segments.push({ kind: 'database', name: db })
  if (coll) segments.push({ kind: 'collection', name: coll })
  return {
    id, kind, type: 'mongodb.' + (kind === 'shell' ? 'shell' : kind === 'indexes' ? 'indexes' : 'find'),
    connectionId: connId, connectionName: 'Sales', dbName: db, collectionName: coll,
    connId, connName: 'Sales', dbName: db, collName: coll,
    target: createResourceRef(connId, segments),
  }
}

const quickstart = { id: 'q', kind: 'quickstart', type: 'app.quickstart', title: 'Quickstart' }

function seedStore(arr, activeId) {
  tabs.value = arr
  activeTabId.value = activeId
}

beforeEach(() => {
  vi.clearAllMocks()
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
    const features = makeFeatures({ disconnectConn: vi.fn(), getConnections: vi.fn(() => [{ id: 'c1' }]) })
    await features.runFeature('Disconnect', { connId: 'c1', connName: 'Sales' }, { label: 'Sales' })
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
    const features = makeFeatures({
      disconnectConn: vi.fn(),
      getConnections: vi.fn(() => [{ id: 'c1' }, { id: 'c2' }]),
    })
    await features.runFeature('Disconnect Others', { connId: 'c1', connName: 'Sales' })
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
    const features = makeFeatures({
      disconnectConn: vi.fn(),
      getConnections: vi.fn(() => [{ id: 'c1' }, { id: 'c2' }]),
    })
    await features.runFeature('Disconnect All', {})
    expect(disconnect).toHaveBeenCalledWith('c1')
    expect(disconnect).toHaveBeenCalledWith('c2')
    expect(tabs.value.map(t => t.id)).toEqual(['q'])
    expect(activeTabId.value).toBe('q')
  })
})

describe('global toolbar routing', () => {
  it('routes a database tool through the active tab', () => {
    const openShellTab = vi.fn()
    seedStore([tab('f', 'c1', 'shop', 'orders')], 'f')
    const features = makeFeatures({}, { openShellTab })

    features.handleTool('shell')

    expect(openShellTab).toHaveBeenCalledWith({
      connectionId: 'c1',
      connectionName: 'Sales',
      dbName: 'shop',
    })
  })

  it('opens the collection explicitly resolved by the native menu', () => {
    const openCollectionTab = vi.fn()
    const target = tab('target', 'c2', 'warehouse', 'stock')
    const features = makeFeatures({ openSelectedCollection: vi.fn() }, { openCollectionTab })

    features.handleTool('collection', target)

    expect(openCollectionTab).toHaveBeenCalledWith({
      connectionId: 'c2',
      connectionName: 'Sales',
      dbName: 'warehouse',
      collectionName: 'stock',
    })
  })
})

describe('color tag persistence', () => {
  it('shows a normalized error when saving a tag fails', async () => {
    const contextMenu = ref({
      type: 'collection',
      nodeData: { connId: 'c1', dbName: 'db', collName: 'orders' },
    })
    const showToast = vi.fn()
    const applyColorTag = vi.fn().mockRejectedValue({ code: 'command', message: 'disk full' })
    const features = makeFeatures({}, { contextMenu, showToast, applyColorTag })

    await features.handleContextAction('Choose Color:red')

    expect(showToast).toHaveBeenCalledWith('Could not save color tag: disk full')
  })
})
