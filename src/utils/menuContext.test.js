import { describe, it, expect } from 'vitest'
import { deriveMenuContext, resolveMenuTarget } from './menuContext'

// These lock the fix that made the native menu usable: context is the union of the
// active tab and the sidebar/tree selection, so selecting a node in the tree
// enables the matching items even while the context-less Quickstart tab is active.

const quickstart = { id: 't0', kind: 'quickstart', title: 'Quickstart' }
const collectionTab = {
  id: 't1', kind: 'collection',
  connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: 'orders',
}

describe('deriveMenuContext', () => {
  it('is all-false with no tab, no selection, no connections', () => {
    expect(deriveMenuContext(null, null, 0)).toEqual({
      hasConnection: false, hasDatabase: false, hasCollection: false, anyConnection: false,
      hasDocument: false, hasField: false, hasIndex: false, readOnly: false,
    })
  })

  it('Quickstart active with no selection gates everything off', () => {
    const ctx = deriveMenuContext(quickstart, null, 0)
    expect(ctx.hasConnection).toBe(false)
    expect(ctx.hasDatabase).toBe(false)
    expect(ctx.hasCollection).toBe(false)
  })

  it('a collection selected in the sidebar enables all three, even on Quickstart', () => {
    const sel = { connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: 'orders', kind: 'collection' }
    const ctx = deriveMenuContext(quickstart, sel, 1)
    expect(ctx.hasConnection).toBe(true)
    expect(ctx.hasDatabase).toBe(true)
    expect(ctx.hasCollection).toBe(true)
  })

  it('a database selected in the sidebar enables connection + database only', () => {
    const sel = { connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: null, kind: 'database' }
    const ctx = deriveMenuContext(quickstart, sel, 1)
    expect(ctx.hasConnection).toBe(true)
    expect(ctx.hasDatabase).toBe(true)
    expect(ctx.hasCollection).toBe(false)
  })

  it('a connection selected in the sidebar enables connection only', () => {
    const sel = { connectionId: 'c1', connectionName: 'Local', dbName: null, collectionName: null, kind: 'connection' }
    const ctx = deriveMenuContext(quickstart, sel, 1)
    expect(ctx.hasConnection).toBe(true)
    expect(ctx.hasDatabase).toBe(false)
    expect(ctx.hasCollection).toBe(false)
  })

  it('an active collection tab still satisfies all three (no regression)', () => {
    const ctx = deriveMenuContext(collectionTab, null, 1)
    expect(ctx.hasConnection).toBe(true)
    expect(ctx.hasDatabase).toBe(true)
    expect(ctx.hasCollection).toBe(true)
  })

  it('anyConnection tracks open connections, for Refresh (no active-tab connection needed)', () => {
    expect(deriveMenuContext(quickstart, null, 0).anyConnection).toBe(false)
    expect(deriveMenuContext(quickstart, null, 2).anyConnection).toBe(true)
    // Also true purely from the active tab's connection.
    expect(deriveMenuContext(collectionTab, null, 0).anyConnection).toBe(true)
  })

  it('document/field context comes from the active collection tab, never the sidebar', () => {
    // A collection selected in the sidebar enables collection items but NOT the
    // Document menu — there is no results grid / selection there.
    const collSel = { connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: 'orders', kind: 'collection' }
    const fromSidebar = deriveMenuContext(quickstart, collSel, 1)
    expect(fromSidebar.hasCollection).toBe(true)
    expect(fromSidebar.hasDocument).toBe(false)
    expect(fromSidebar.hasField).toBe(false)

    // A collection tab with results but no row selected: still no document context.
    const noSelection = { ...collectionTab, results: [{ _id: 1 }], selectedRow: -1 }
    expect(deriveMenuContext(noSelection, null, 1).hasDocument).toBe(false)

    // A row selected enables whole-document actions but not field actions.
    const rowSelected = { ...collectionTab, results: [{ _id: 1 }], selectedRow: 0 }
    const rowCtx = deriveMenuContext(rowSelected, null, 1)
    expect(rowCtx.hasDocument).toBe(true)
    expect(rowCtx.hasField).toBe(false)

    // A selected field enables both.
    const fieldSelected = { ...collectionTab, results: [{ _id: 1 }], selectedRow: 0, selectedField: '_id' }
    const fieldCtx = deriveMenuContext(fieldSelected, null, 1)
    expect(fieldCtx.hasDocument).toBe(true)
    expect(fieldCtx.hasField).toBe(true)
  })

  it('hasIndex reflects the Indexes-dialog selection, independent of tab/tree', () => {
    // No index selected → off, even with a full collection context.
    expect(deriveMenuContext(null, null, 0).hasIndex).toBe(false)
    expect(deriveMenuContext(null, null, 0, false).hasIndex).toBe(false)
    // An index selected → on, regardless of the tab/tree selection.
    expect(deriveMenuContext(null, null, 0, true).hasIndex).toBe(true)
  })

  it('readOnly comes from the active tab, never the sidebar', () => {
    const collSel = { connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: 'orders', kind: 'collection' }
    // A locked tab locks the context even with no sidebar selection.
    expect(deriveMenuContext({ ...collectionTab, readOnly: true }, null, 1).readOnly).toBe(true)
    // An unlocked tab stays unlocked even when a sidebar node is selected.
    expect(deriveMenuContext(collectionTab, collSel, 1).readOnly).toBe(false)
    // The sidebar selection alone (Quickstart active) never locks anything.
    expect(deriveMenuContext(quickstart, collSel, 1).readOnly).toBe(false)
  })
})

describe('resolveMenuTarget', () => {
  it('prefers the sidebar selection over the active tab', () => {
    const sel = { connectionId: 'c2', connectionName: 'Prod', dbName: 'analytics', collectionName: 'events', kind: 'collection' }
    expect(resolveMenuTarget(collectionTab, sel)).toEqual({
      connectionId: 'c2', connectionName: 'Prod', dbName: 'analytics', collectionName: 'events', kind: 'collection',
    })
  })

  it('derives kind from the deepest field present', () => {
    const dbSel = { connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: null }
    expect(resolveMenuTarget(null, dbSel).kind).toBe('database')
    const connSel = { connectionId: 'c1', connectionName: 'Local', dbName: null, collectionName: null }
    expect(resolveMenuTarget(null, connSel).kind).toBe('connection')
  })

  it('falls back to the active tab when nothing is selected', () => {
    expect(resolveMenuTarget(collectionTab, null)).toBe(collectionTab)
  })

  it('returns null when neither a selection nor a tab is available', () => {
    expect(resolveMenuTarget(null, null)).toBe(null)
  })

  it('falls back to the active tab when the selection is too shallow for the level', () => {
    // Collection tab active, but a bare connection is highlighted. A collection-
    // scoped action must act on the tab (which its gate lit up), not the shallow
    // selection — otherwise the enabled item would only toast a guide message.
    const connSel = { connectionId: 'c2', connectionName: 'Prod', dbName: null, collectionName: null, kind: 'connection' }
    expect(resolveMenuTarget(collectionTab, connSel, 'collection')).toBe(collectionTab)
    // A database-scoped action likewise falls through to the collection tab.
    expect(resolveMenuTarget(collectionTab, connSel, 'database')).toBe(collectionTab)
    // A connection-scoped action is satisfied by the selection, so it wins.
    expect(resolveMenuTarget(collectionTab, connSel, 'connection').connectionId).toBe('c2')
  })

  it('prefers the sidebar selection when it satisfies the required level', () => {
    const collSel = { connectionId: 'c2', connectionName: 'Prod', dbName: 'analytics', collectionName: 'events', kind: 'collection' }
    expect(resolveMenuTarget(collectionTab, collSel, 'collection').connectionId).toBe('c2')
  })

  it('returns the shallow selection for the guide message when neither satisfies', () => {
    const connSel = { connectionId: 'c2', connectionName: 'Prod', dbName: null, collectionName: null, kind: 'connection' }
    expect(resolveMenuTarget(quickstart, connSel, 'collection').connectionId).toBe('c2')
  })
})
