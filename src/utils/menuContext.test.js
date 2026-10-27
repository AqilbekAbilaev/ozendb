import { describe, it, expect, beforeEach } from 'vitest'
import { deriveMenuContext, resolveMenuTarget, resolvePgMenuTarget } from './menuContext'
import { ENGINES } from '../engines/index.js'
import { selectedIndex } from '../stores/indexes'
import { selectedGridfsFile } from '../engines/mongodb/tools/gridfsSelection'
import { registerWorkspaceDefinitions } from '../workspaces/registerDefinitions'

// These lock the fix that made the native menu usable: context is the union of the
// active tab and the sidebar/tree selection, so selecting a node in the tree
// enables the matching items even while the context-less Quickstart tab is active.

import { createResourceRef } from './resourceRef'

// MongoDB's document switches ask the registry whether the active tab is a collection tab.
registerWorkspaceDefinitions()

beforeEach(() => {
  selectedIndex.value = null
  selectedGridfsFile.value = null
})

// The context the menu gets from the real engine table, as useMenu builds it.
function derive(activeTab, treeSelection, connectionCount, { canRefresh = false, openTabs = [] } = {}) {
  return deriveMenuContext({ activeTab, treeSelection, connectionCount, canRefresh, openTabs, engines: Object.values(ENGINES) })
}

// A tab's identity is the `target` its definition gives it; these mirror those.
function ref(connectionId, dbName, collectionName) {
  const segments = []
  if (dbName) segments.push({ kind: 'database', name: dbName })
  if (collectionName) segments.push({ kind: 'collection', name: collectionName })
  return createResourceRef(connectionId, segments)
}

// Selections are built exactly the way useConnectionTree builds them, so these
// fixtures cannot drift from the payload the menu actually receives at runtime.
function selection(connectionId, connectionName, dbName, collectionName, engine = 'mongodb') {
  return { resource: ref(connectionId, dbName, collectionName), connectionName, engine }
}

const quickstart = { id: 't0', type: 'app.quickstart', title: 'Quickstart' }
const collectionTab = {
  id: 't1', type: 'mongodb.find', target: ref('c1', 'shop', 'orders'),
  connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: 'orders',
  runtime: { results: [], selectedRow: -1, selectedField: null },
}
const withRuntime = (runtime) => ({ ...collectionTab, runtime: { ...collectionTab.runtime, ...runtime } })

describe('deriveMenuContext', () => {
  it('is all-false with no tab, no selection, no connections', () => {
    expect(derive(null, null, 0)).toEqual({
      hasConnection: false, hasDatabase: false, hasCollection: false, anyConnection: false,
      hasDocument: false, hasField: false, hasIndex: false, hasGridfsFile: false,
      readOnly: false, canRefreshTab: false,
      hasPgSchema: false, hasPgTable: false, engine: 'none',
    })
  })

  // A click on a file row clears the tree selection, so this must hold on its own (#258).
  it('a file selected in the GridFS dialog sets hasGridfsFile on its own', () => {
    selectedGridfsFile.value = { id: 'f1', filename: 'logo 2.png' }
    const ctx = derive(null, null, 0)
    expect(ctx.hasGridfsFile).toBe(true)
    expect(ctx.hasDatabase).toBe(false)
  })

  it('no GridFS file selected leaves hasGridfsFile false even with a collection selected', () => {
    const sel = selection('c1', 'Local', 'shop', 'orders')
    expect(derive(quickstart, sel, 1).hasGridfsFile).toBe(false)
  })

  it('Quickstart active with no selection gates everything off', () => {
    const ctx = derive(quickstart, null, 0)
    expect(ctx.hasConnection).toBe(false)
    expect(ctx.hasDatabase).toBe(false)
    expect(ctx.hasCollection).toBe(false)
  })

  it('a collection selected in the sidebar enables all three, even on Quickstart', () => {
    const sel = selection('c1', 'Local', 'shop', 'orders')
    const ctx = derive(quickstart, sel, 1)
    expect(ctx.hasConnection).toBe(true)
    expect(ctx.hasDatabase).toBe(true)
    expect(ctx.hasCollection).toBe(true)
  })

  it('a database selected in the sidebar enables connection + database only', () => {
    const sel = selection('c1', 'Local', 'shop', null)
    const ctx = derive(quickstart, sel, 1)
    expect(ctx.hasConnection).toBe(true)
    expect(ctx.hasDatabase).toBe(true)
    expect(ctx.hasCollection).toBe(false)
  })

  it('a connection selected in the sidebar enables connection only', () => {
    const sel = selection('c1', 'Local', null, null)
    const ctx = derive(quickstart, sel, 1)
    expect(ctx.hasConnection).toBe(true)
    expect(ctx.hasDatabase).toBe(false)
    expect(ctx.hasCollection).toBe(false)
  })

  it('an active collection tab still satisfies all three (no regression)', () => {
    const ctx = derive(collectionTab, null, 1)
    expect(ctx.hasConnection).toBe(true)
    expect(ctx.hasDatabase).toBe(true)
    expect(ctx.hasCollection).toBe(true)
  })

  it('anyConnection tracks open connections, for Refresh (no active-tab connection needed)', () => {
    expect(derive(quickstart, null, 0).anyConnection).toBe(false)
    expect(derive(quickstart, null, 2).anyConnection).toBe(true)
    // Also true purely from the active tab's connection.
    expect(derive(collectionTab, null, 0).anyConnection).toBe(true)
  })

  it('document/field context comes from the active collection tab, never the sidebar', () => {
    // A collection selected in the sidebar enables collection items but NOT the
    // Document menu — there is no results grid / selection there.
    const collSel = selection('c1', 'Local', 'shop', 'orders')
    const fromSidebar = derive(quickstart, collSel, 1)
    expect(fromSidebar.hasCollection).toBe(true)
    expect(fromSidebar.hasDocument).toBe(false)
    expect(fromSidebar.hasField).toBe(false)

    // A collection tab with results but no row selected: still no document context.
    const noSelection = withRuntime({ results: [{ _id: 1 }], selectedRow: -1 })
    expect(derive(noSelection, null, 1).hasDocument).toBe(false)

    // A row selected enables whole-document actions but not field actions.
    const rowSelected = withRuntime({ results: [{ _id: 1 }], selectedRow: 0 })
    const rowCtx = derive(rowSelected, null, 1)
    expect(rowCtx.hasDocument).toBe(true)
    expect(rowCtx.hasField).toBe(false)

    // A selected field enables both.
    const fieldSelected = withRuntime({ results: [{ _id: 1 }], selectedRow: 0, selectedField: '_id' })
    const fieldCtx = derive(fieldSelected, null, 1)
    expect(fieldCtx.hasDocument).toBe(true)
    expect(fieldCtx.hasField).toBe(true)
  })

  it('hasIndex reflects the Indexes-dialog selection, independent of tab/tree', () => {
    // No index selected → off, even with a full collection context.
    expect(derive(null, null, 0).hasIndex).toBe(false)
    // An index selected → on, regardless of the tab/tree selection.
    selectedIndex.value = { name: 'sku 1_-1' }
    expect(derive(null, null, 0).hasIndex).toBe(true)
  })

  it('enables Refresh as the active tab says, whatever the sidebar holds', () => {
    const sel = selection('c1', 'Local', 'shop', 'orders')
    expect(derive(collectionTab, sel, 1, { canRefresh: true }).canRefreshTab).toBe(true)
    expect(derive(quickstart, sel, 1, { canRefresh: false }).canRefreshTab).toBe(false)
  })

  it('readOnly comes from the active tab, never the sidebar', () => {
    const collSel = selection('c1', 'Local', 'shop', 'orders')
    // A locked tab locks the context even with no sidebar selection.
    expect(derive({ ...collectionTab, readOnly: true }, null, 1).readOnly).toBe(true)
    // An unlocked tab stays unlocked even when a sidebar node is selected.
    expect(derive(collectionTab, collSel, 1).readOnly).toBe(false)
    // The sidebar selection alone (Quickstart active) never locks anything.
    expect(derive(quickstart, collSel, 1).readOnly).toBe(false)
  })

  // A Current Operations tab carries dbName/collName as *filters*, not identity. The
  // old field-presence check read them as identity and lit the whole Database menu.
  it('does not let Current Operations filters enable the database menu', () => {
    const ops = { id: 't2', type: 'mongodb.current_operations', target: ref('c1'), connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collName: 'orders' }
    const ctx = derive(ops, null, 1)
    expect(ctx.hasConnection).toBe(true)
    expect(ctx.hasDatabase).toBe(false)
    expect(ctx.hasCollection).toBe(false)
  })

  // Schema/Indexes/Export/Import are collection-scoped workspaces, so collection
  // actions apply to them just as they do to a find tab.
  it('enables collection actions for collection-scoped tool tabs', () => {
    const schema = { id: 't3', type: 'mongodb.schema', target: ref('c1', 'shop', 'orders'), connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: 'orders' }
    const ctx = derive(schema, null, 1)
    expect(ctx.hasDatabase).toBe(true)
    expect(ctx.hasCollection).toBe(true)
  })

  it('gates everything off for a workspace kind that names no resource', () => {
    const ctx = derive({ id: 't4', kind: 'not-a-registered-kind', connId: 'c1' }, null, 0)
    expect(ctx.hasConnection).toBe(false)
    expect(ctx.anyConnection).toBe(false)
  })
})

// Every item behind the Connection / Database / Collection gates is a MongoDB action,
// so a PostgreSQL selection or tab must never light one up or be handed to one.
describe('PostgreSQL never reaches the MongoDB gates', () => {
  const pgConnection = selection('p1', 'Payments PG', null, null, 'postgresql')
  const pgTableTab = {
    id: 't9', type: 'postgresql.table_browse', engine: 'postgresql',
    target: createResourceRef('p1', [{ kind: 'database', name: 'payments' }, { kind: 'schema', name: 'public' }, { kind: 'table', name: 'merchants' }]),
    connectionName: 'Payments PG',
  }

  it('a PostgreSQL connection selected in the sidebar enables no connection item', () => {
    const ctx = derive(quickstart, pgConnection, 1)
    expect([ctx.hasConnection, ctx.hasDatabase, ctx.hasCollection]).toEqual([false, false, false])
    // Refresh still works on every open connection, whatever its engine.
    expect(ctx.anyConnection).toBe(true)
  })

  it('a PostgreSQL tab enables none of them either', () => {
    const ctx = derive(pgTableTab, pgConnection, 1)
    expect([ctx.hasConnection, ctx.hasDatabase, ctx.hasCollection]).toEqual([false, false, false])
  })

  it('a MongoDB tab still counts while a PostgreSQL connection is selected', () => {
    const ctx = derive(collectionTab, pgConnection, 2)
    expect([ctx.hasConnection, ctx.hasDatabase, ctx.hasCollection]).toEqual([true, true, true])
    expect(resolveMenuTarget(collectionTab, pgConnection, 'connection').resource.connectionId).toBe('c1')
  })

  it('never hands a PostgreSQL connection to an action — ⌘L finds no database to open a shell on', () => {
    expect(resolveMenuTarget(quickstart, pgConnection, 'connection')).toBe(null)
    expect(resolveMenuTarget(pgTableTab, pgConnection, 'database')).toBe(null)
  })
})

describe('resolveMenuTarget', () => {
  it('prefers the sidebar selection over the active tab', () => {
    const sel = selection('c2', 'Prod', 'analytics', 'events')
    expect(resolveMenuTarget(collectionTab, sel)).toEqual({
      resource: ref('c2', 'analytics', 'events'), connectionName: 'Prod',
    })
  })

  // The tree builds the selection's ref (see useConnectionTree), and that is
  // authoritative — the level is never guessed from which fields happen to be set.
  it('takes the level from the selection\'s ref', () => {
    const dbSel = selection('c1', 'Local', 'shop', null)
    expect(resolveMenuTarget(null, dbSel).resource).toEqual(ref('c1', 'shop'))
    const connSel = selection('c1', 'Local', null, null)
    expect(resolveMenuTarget(null, connSel).resource).toEqual(ref('c1'))
  })

  it('names no resource for a selection without a ref rather than guessing one', () => {
    expect(resolveMenuTarget(null, { connectionId: 'c1', dbName: 'shop' })).toBe(null)
  })

  it('falls back to the active tab when nothing is selected', () => {
    expect(resolveMenuTarget(collectionTab, null)).toEqual({
      resource: ref('c1', 'shop', 'orders'), connectionName: 'Local',
    })
  })

  it('returns null when neither a selection nor a tab is available', () => {
    expect(resolveMenuTarget(null, null)).toBe(null)
  })

  it('falls back to the active tab when the selection is too shallow for the level', () => {
    // Collection tab active, but a bare connection is highlighted. A collection-
    // scoped action must act on the tab (which its gate lit up), not the shallow
    // selection — otherwise the enabled item would only toast a guide message.
    const connSel = selection('c2', 'Prod', null, null)
    expect(resolveMenuTarget(collectionTab, connSel, 'collection')).toEqual({
      resource: ref('c1', 'shop', 'orders'), connectionName: 'Local',
    })
    // A database-scoped action likewise falls through to the collection tab.
    expect(resolveMenuTarget(collectionTab, connSel, 'database').resource).toEqual(ref('c1', 'shop', 'orders'))
    // A connection-scoped action is satisfied by the selection, so it wins.
    expect(resolveMenuTarget(collectionTab, connSel, 'connection').resource).toEqual(ref('c2'))
  })

  it('prefers the sidebar selection when it satisfies the required level', () => {
    const collSel = selection('c2', 'Prod', 'analytics', 'events')
    expect(resolveMenuTarget(collectionTab, collSel, 'collection').resource).toEqual(ref('c2', 'analytics', 'events'))
  })

  it('returns the shallow selection for the guide message when neither satisfies', () => {
    const connSel = selection('c2', 'Prod', null, null)
    expect(resolveMenuTarget(quickstart, connSel, 'collection').resource).toEqual(ref('c2'))
  })

  // A tool tab resolves through its target, like every other tab.
  it('resolves a tool tab through its target', () => {
    const schema = { id: 't3', type: 'mongodb.schema', target: ref('c1', 'shop', 'orders'), connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: 'orders' }
    expect(resolveMenuTarget(schema, null, 'collection')).toEqual({
      resource: ref('c1', 'shop', 'orders'), connectionName: 'Local',
    })
  })
})

// #145: the PostgreSQL gates are the union of the active tab and the sidebar
// selection, the same as the Mongo ones above — PostgresTreeNodes feeds its clicked
// schema/table row into the shared tree-selection store.
// Tabs as their definitions build them: identity is the ref alone (#303). A query tab
// is database-scoped; a table tab names its schema and table.
const pgQueryTab = {
  id: 'p1', type: 'postgresql.query', connectionName: 'PG',
  target: createResourceRef('c1', [{ kind: 'database', name: 'app' }]),
}
const pgTableTab = {
  id: 'p2', type: 'postgresql.table_browse', connectionName: 'PG',
  target: createResourceRef('c1', [{ kind: 'database', name: 'app' }, { kind: 'schema', name: 'public' }, { kind: 'table', name: 'widgets' }]),
}

describe('deriveMenuContext (PostgreSQL)', () => {
  it('a query tab enables the schema gate only', () => {
    const ctx = derive(pgQueryTab, null, 0)
    expect(ctx.hasPgSchema).toBe(true)
    expect(ctx.hasPgTable).toBe(false)
  })

  it('a table tab enables both the schema and table gates', () => {
    const ctx = derive(pgTableTab, null, 0)
    expect(ctx.hasPgSchema).toBe(true)
    expect(ctx.hasPgTable).toBe(true)
  })

  it('a search tab is schema-scoped, so it enables the schema gate (#180)', () => {
    const searchTab = { id: 'p3', type: 'postgresql.search', connectionId: 'c1', connectionName: 'PG', database: 'app', schema: 'public' }
    const ctx = derive(searchTab, null, 0)
    expect(ctx.hasPgSchema).toBe(true)
    expect(ctx.hasPgTable).toBe(false)
  })

  it('a non-PostgreSQL tab, or none, enables neither', () => {
    expect(derive(collectionTab, null, 0).hasPgSchema).toBe(false)
    expect(derive(null, null, 0).hasPgSchema).toBe(false)
  })

  it('reads the table tab\'s own accidental-edit lock, nested under state', () => {
    const locked = { ...pgTableTab, state: { readOnly: true } }
    expect(derive(locked, null, 0).readOnly).toBe(true)
    expect(derive(pgTableTab, null, 0).readOnly).toBe(false)
  })
})

// Built the way PostgresTreeNodes builds them, so these cannot drift from the runtime
// payload — the PostgreSQL levels name their own fields (database/schema/table).
function pgSelection(kind, fields) {
  const sel = {
    connectionId: 'c1', connectionName: 'PG', engine: 'postgresql',
    database: null, schema: null, table: null, kind, ...fields,
  }
  const segments = []
  if (sel.database) segments.push({ kind: 'database', name: sel.database })
  if (sel.schema) segments.push({ kind: 'schema', name: sel.schema })
  if (sel.table) segments.push({ kind: 'table', name: sel.table })
  return { ...sel, resource: createResourceRef(sel.connectionId, segments) }
}

describe('deriveMenuContext (PostgreSQL sidebar selection)', () => {
  it('a selected schema enables the schema gate with no tab open', () => {
    const ctx = derive(quickstart, pgSelection('schema', { database: 'app', schema: 'public' }), 1)
    expect(ctx.hasPgSchema).toBe(true)
    expect(ctx.hasPgTable).toBe(false)
  })

  it('a selected table enables both gates with no tab open', () => {
    const ctx = derive(quickstart, pgSelection('table', { database: 'app', schema: 'public', table: 'widgets' }), 1)
    expect(ctx.hasPgSchema).toBe(true)
    expect(ctx.hasPgTable).toBe(true)
  })

  it('a shallower PostgreSQL selection enables neither', () => {
    const connSel = pgSelection('connection', {})
    expect(derive(quickstart, connSel, 1).hasPgSchema).toBe(false)
    expect(derive(quickstart, connSel, 1).hasPgTable).toBe(false)
  })

  // A Mongo collection is two segments deep, as a Postgres schema is — the engine is
  // what separates them, not the depth.
  it('a MongoDB selection never enables the PostgreSQL gates', () => {
    const ctx = derive(quickstart, selection('c1', 'Local', 'shop', 'orders'), 1)
    expect(ctx.hasPgSchema).toBe(false)
    expect(ctx.hasPgTable).toBe(false)
  })

  // The mirror of the Mongo rule: a Postgres tab must not light up the Mongo gates.
  it('a PostgreSQL selection never enables the MongoDB gates', () => {
    const ctx = derive(quickstart, pgSelection('table', { database: 'app', schema: 'public', table: 'widgets' }), 1)
    expect(ctx.hasDatabase).toBe(false)
    expect(ctx.hasCollection).toBe(false)
  })
})

describe('resolvePgMenuTarget', () => {
  it('resolves a query tab, carrying its engine and both alias spellings', () => {
    expect(resolvePgMenuTarget(pgQueryTab)).toEqual({
      connId: 'c1', engine: 'postgresql', connName: 'PG', connectionId: 'c1', connectionName: 'PG',
      database: 'app', schema: null, table: null,
    })
  })

  it('resolves a table tab with its table name', () => {
    expect(resolvePgMenuTarget(pgTableTab).table).toBe('widgets')
  })

  it('is null for a non-PostgreSQL tab, or none', () => {
    expect(resolvePgMenuTarget(collectionTab)).toBeNull()
    expect(resolvePgMenuTarget(null)).toBeNull()
  })

  // Same precedence rule as resolveMenuTarget: the sidebar selection wins when it is
  // deep enough for the action, since that is what the user just clicked.
  it('prefers a deep-enough sidebar selection over the active tab', () => {
    const sel = pgSelection('table', { database: 'other', schema: 'audit', table: 'events' })
    expect(resolvePgMenuTarget(pgTableTab, sel, 'table')).toEqual({
      connId: 'c1', engine: 'postgresql', connName: 'PG', connectionId: 'c1', connectionName: 'PG',
      database: 'other', schema: 'audit', table: 'events',
    })
  })

  it('falls back to the active tab when the selection is too shallow', () => {
    const sel = pgSelection('schema', { database: 'other', schema: 'audit' })
    expect(resolvePgMenuTarget(pgTableTab, sel, 'table').table).toBe('widgets')
  })

  it('resolves a selected schema with no PostgreSQL tab open', () => {
    const sel = pgSelection('schema', { database: 'app', schema: 'public' })
    expect(resolvePgMenuTarget(quickstart, sel, 'schema')).toEqual({
      connId: 'c1', engine: 'postgresql', connName: 'PG', connectionId: 'c1', connectionName: 'PG',
      database: 'app', schema: 'public', table: null,
    })
  })

  it('is null when neither the tab nor the selection is PostgreSQL', () => {
    expect(resolvePgMenuTarget(collectionTab, selection('c1', 'Local', 'shop', 'orders'), 'schema')).toBeNull()
  })
})

describe('deriveMenuContext engine (#152)', () => {
  const mongoTab = { ...collectionTab, engine: 'mongodb' }
  const pgTab = { ...pgTableTab, engine: 'postgresql' }

  it("is 'none' with nothing to name an engine, so neither engine's items show", () => {
    expect(derive({ ...quickstart, engine: 'app' }, null, 0).engine).toBe('none')
    expect(derive(null, null, 0).engine).toBe('none')
  })

  it('reads the active tab when nothing is selected in the sidebar', () => {
    expect(derive(mongoTab, null, 1).engine).toBe('mongodb')
    expect(derive(pgTab, null, 1).engine).toBe('postgresql')
  })

  it('follows a sidebar selection that enables something when the tab names no engine', () => {
    const app = { ...quickstart, engine: 'app' }
    const pgSel = pgSelection('table', { database: 'app', schema: 'public', table: 'widgets' })
    expect(derive(app, pgSel, 1).engine).toBe('postgresql')
    expect(derive(app, selection('c1', 'Local', 'shop', 'orders'), 1).engine).toBe('mongodb')
  })

  it('ignores a PostgreSQL selection too shallow to enable anything', () => {
    // Clicking a connection or database row to expand it must not hide the open
    // MongoDB tab's items: no PostgreSQL item enables below a schema.
    const pgConn = pgSelection('connection', {})
    const pgDb = pgSelection('database', { database: 'app' })
    expect(derive(mongoTab, pgConn, 2).engine).toBe('mongodb')
    expect(derive(mongoTab, pgDb, 2).engine).toBe('mongodb')
    expect(derive({ ...quickstart, engine: 'app' }, pgDb, 1).engine).toBe('none')
  })

  it('lets a live selection win over a tab of the other engine', () => {
    const pgSel = pgSelection('table', { database: 'app', schema: 'public', table: 'widgets' })
    expect(derive(mongoTab, pgSel, 2).engine).toBe('postgresql')
    expect(derive(pgTab, selection('c1', 'Local', null, null), 2).engine).toBe('mongodb')
  })

  it('agrees with a live selection of the same engine as the tab', () => {
    const pgSel = pgSelection('schema', { database: 'app', schema: 'public' })
    expect(derive(pgTab, pgSel, 1).engine).toBe('postgresql')
  })

  it('treats a selection with no engine as MongoDB, like the gates do', () => {
    const legacy = { ...selection('c1', 'Local', 'shop', 'orders'), engine: undefined }
    expect(derive({ ...quickstart, engine: 'app' }, legacy, 1).engine).toBe('mongodb')
  })

  it("is 'none' for an engine the menu has no items for", () => {
    expect(derive({ ...mongoTab, engine: 'mysql' }, null, 1).engine).toBe('none')
  })
})

// #156: a write action aimed at the sidebar selection must respect the lock of an
// open tab on that same resource, not only the active tab's.
describe('deriveMenuContext read-only for a sidebar target', () => {
  const app = { ...quickstart, engine: 'app' }
  const orders = { connectionId: 'c1', segments: [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }] }
  const users = { connectionId: 'c1', segments: [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'users' }] }
  const widgets = {
    connectionId: 'c1',
    segments: [{ kind: 'database', name: 'app' }, { kind: 'schema', name: 'public' }, { kind: 'table', name: 'widgets' }],
  }
  const ordersSel = selection('c1', 'Local', 'shop', 'orders')
  const widgetsSel = pgSelection('table', { database: 'app', schema: 'public', table: 'widgets' })

  it('locks when an open tab on the selected collection is locked', () => {
    const locked = { id: 'x', target: orders, readOnly: true }
    expect(derive(app, ordersSel, 1, { openTabs: [app, locked] }).readOnly).toBe(true)
  })

  it('locks when an open PostgreSQL tab on the selected table is locked', () => {
    const locked = { id: 'p', target: widgets, state: { readOnly: true } }
    expect(derive(app, widgetsSel, 1, { openTabs: [app, locked] }).readOnly).toBe(true)
  })

  it('stays unlocked when the selected resource has no locked tab', () => {
    const unlocked = { id: 'x', target: orders, readOnly: false }
    const lockedElsewhere = { id: 'y', target: users, readOnly: true }
    expect(derive(app, ordersSel, 1, { openTabs: [app, unlocked, lockedElsewhere] }).readOnly).toBe(false)
  })

  it('ignores open tabs when nothing is selected', () => {
    const locked = { id: 'x', target: orders, readOnly: true }
    expect(derive(app, null, 1, { openTabs: [app, locked] }).readOnly).toBe(false)
  })
})

// The shared rule alone, with stand-in engines: it never asks which engine is which.
describe('deriveMenuContext over the engines it is given', () => {
  const engine = (id, { enablesSelection = false, switches = {}, tabNamesConnection } = {}) => ({
    id,
    menu: { switches: () => switches, selectionEnables: () => enablesSelection, tabNamesConnection },
  })
  const derive = (activeTab, treeSelection, engines, connectionCount = 1) =>
    deriveMenuContext({ activeTab, treeSelection, connectionCount, canRefresh: false, openTabs: [], engines })
  const sel = { resource: createResourceRef('k 1', [{ kind: 'keyspace', name: 'ünits/2' }]) }

  it("merges every engine's switches into the context", () => {
    const ctx = derive(null, null, [engine('alpha', { switches: { hasA: true } }), engine('beta', { switches: { hasB: false } })])
    expect(ctx.hasA).toBe(true)
    expect(ctx.hasB).toBe(false)
  })

  it('lets the engine whose selection enables something decide, over the tab', () => {
    const engines = [engine('alpha'), engine('beta', { enablesSelection: true })]
    expect(derive({ engine: 'alpha' }, sel, engines).engine).toBe('beta')
  })

  it("falls back to the active tab's engine when no selection enables anything", () => {
    expect(derive({ engine: 'alpha' }, sel, [engine('alpha'), engine('beta')]).engine).toBe('alpha')
  })

  it("is 'none' for a tab of an engine without a menu entry", () => {
    expect(derive({ engine: 'gamma' }, sel, [engine('alpha'), { id: 'gamma' }]).engine).toBe('none')
  })

  it('takes no switches from an engine without a menu entry', () => {
    expect(derive(null, null, [{ id: 'gamma' }])).toEqual({ anyConnection: true, readOnly: false, canRefreshTab: false, engine: 'none' })
  })

  it('counts an active tab as an open connection only when its engine says so', () => {
    const holds = engine('alpha', { tabNamesConnection: () => true })
    expect(derive({ engine: 'alpha' }, null, [holds], 0).anyConnection).toBe(true)
    expect(derive({ engine: 'beta' }, null, [engine('beta')], 0).anyConnection).toBe(false)
  })
})
