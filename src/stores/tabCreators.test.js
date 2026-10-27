import { describe, it, expect, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

// Definitions must be registered before the tab store can build its Quickstart tab
// (stores/tabs.js creates it through createWorkspace, see initializeTabs). Static
// imports evaluate before this module's body, so the store — and everything importing
// it — is loaded dynamically after the one-time registration.
import { registerWorkspaceDefinitions } from '../workspaces/registerDefinitions'
import { createResourceRef } from '../utils/resourceRef'
registerWorkspaceDefinitions()

const creators = await import('./tabCreators')
const { tabs, activeTabId } = await import('./tabs')

function harness() {
  tabs.value = [{ id: 't0', type: 'app.quickstart', title: 'Quickstart' }]
  activeTabId.value = 't0'
  return creators
}

const collRef = (connectionId, database, collection) => createResourceRef(connectionId, [
  { kind: 'database', name: database }, { kind: 'collection', name: collection },
])
const ORDERS = collRef('c 1', 'shop.eu', 'orders/2026')
const ITEMS = collRef('c 1', 'shop.eu', 'items ü')
const lastTab = () => tabs.value[tabs.value.length - 1]

describe('opening a workspace tab', () => {
  it('appends the new tab and activates it', () => {
    const c = harness()
    c.openWorkspaceTab('mongodb.schema', { target: { resource: ORDERS, connectionName: 'Sales ü' } })
    expect(tabs.value).toHaveLength(2)
    expect(lastTab().type).toBe('mongodb.schema')
    expect(activeTabId.value).toBe(lastTab().id)
  })

  it('gives distinct ids to tabs opened in one tick', () => {
    const c = harness()
    c.openWorkspaceTab('mongodb.schema', { target: { resource: ORDERS, connectionName: 'Sales ü' } })
    c.openWorkspaceTab('mongodb.schema', { target: { resource: ORDERS, connectionName: 'Sales ü' } })
    const [first, second] = tabs.value.slice(-2)
    expect(first.id).not.toBe(second.id)
  })

  it('lets an opener seed a new tab before it reaches the tab strip', () => {
    const c = harness()
    const tab = c.newWorkspaceTab('mongodb.schema', { target: { resource: ORDERS, connectionName: 'Sales ü' } })
    expect(tabs.value).toHaveLength(1)
    c.showWorkspaceTab(tab)
    expect(lastTab().id).toBe(tab.id)
    expect(activeTabId.value).toBe(tab.id)
  })
})

describe('focusing or opening a workspace tab', () => {
  const open = (c, resource) => c.focusOrOpenWorkspaceTab('mongodb.schema', resource, {
    target: { resource, connectionName: 'Sales ü' },
  })

  it('focuses the tab of the same type already showing the resource', () => {
    const c = harness()
    open(c, ORDERS)
    const ordersTab = lastTab()
    activeTabId.value = 't0'
    open(c, ORDERS)
    expect(tabs.value).toHaveLength(2)
    expect(activeTabId.value).toBe(ordersTab.id)
  })

  it('opens a new tab for another resource of the same type', () => {
    const c = harness()
    open(c, ORDERS)
    open(c, ITEMS)
    expect(tabs.value).toHaveLength(3)
    expect(activeTabId.value).toBe(lastTab().id)
  })

  it('opens a new tab when the resource is shown only by a tab of another type', () => {
    const c = harness()
    c.openWorkspaceTab('mongodb.indexes', { target: { resource: ORDERS, connectionName: 'Sales ü' } })
    open(c, ORDERS)
    expect(tabs.value).toHaveLength(3)
    expect(lastTab().type).toBe('mongodb.schema')
  })
})

describe('Quickstart', () => {
  it('focuses the existing Quickstart instead of stacking', () => {
    const c = harness()
    c.openQuickstart()
    expect(tabs.value).toHaveLength(1)
    expect(activeTabId.value).toBe('t0')
  })

  it('reopens Quickstart when it was closed', () => {
    const c = harness()
    tabs.value = []
    c.openQuickstart()
    expect(tabs.value).toHaveLength(1)
    expect(lastTab().type).toBe('app.quickstart')
    expect(activeTabId.value).toBe(lastTab().id)
  })
})
