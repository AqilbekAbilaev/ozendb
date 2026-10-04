import { describe, it, expect } from 'vitest'
import { deriveMenuContext, resolveMenuTarget, resolvePgMenuTarget } from './menuContext'

// These lock the fix that made the native menu usable: context is the union of the
// active tab and the sidebar/tree selection, so selecting a node in the tree
// enables the matching items even while the context-less Quickstart tab is active.

import { resourceFromTreeSelection } from './legacyResourceRef'

// Selections are built exactly the way useConnectionTree builds them, so these
// fixtures cannot drift from the payload the menu actually receives at runtime.
function selection(connectionId, connectionName, dbName, collectionName, kind, engine = 'mongodb') {
  const sel = { connectionId, connectionName, dbName, collectionName, kind, engine }
  return { ...sel, resource: resourceFromTreeSelection(sel) }
}

const quickstart = { id: 't0', kind: 'quickstart', title: 'Quickstart' }
const collectionTab = {
  id: 't1', kind: 'collection',
  connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: 'orders',
  runtime: { results: [], selectedRow: -1, selectedField: null },
}
const withRuntime = (runtime) => ({ ...collectionTab, runtime: { ...collectionTab.runtime, ...runtime } })

describe('deriveMenuContext', () => {
  it('is all-false with no tab, no selection, no connections', () => {
    expect(deriveMenuContext(null, null, 0)).toEqual({
      hasConnection: false, hasDatabase: false, hasCollection: false, anyConnection: false,
      hasDocument: false, hasField: false, hasIndex: false, readOnly: false, canRefreshTab: false,
      hasPgSchema: false, hasPgTable: false, engine: 'none',
    })
  })

  it('Quickstart active with no selection gates everything off', () => {
    const ctx = deriveMenuContext(quickstart, null, 0)
    expect(ctx.hasConnection).toBe(false)
    expect(ctx.hasDatabase).toBe(false)
    expect(ctx.hasCollection).toBe(false)
  })

  it('a collection selected in the sidebar enables all three, even on Quickstart', () => {
    const sel = selection('c1', 'Local', 'shop', 'orders', 'collection')
    const ctx = deriveMenuContext(quickstart, sel, 1)
    expect(ctx.hasConnection).toBe(true)
    expect(ctx.hasDatabase).toBe(true)
    expect(ctx.hasCollection).toBe(true)
  })

  it('a database selected in the sidebar enables connection + database only', () => {
    const sel = selection('c1', 'Local', 'shop', null, 'database')
    const ctx = deriveMenuContext(quickstart, sel, 1)
    expect(ctx.hasConnection).toBe(true)
    expect(ctx.hasDatabase).toBe(true)
    expect(ctx.hasCollection).toBe(false)
  })

  it('a connection selected in the sidebar enables connection only', () => {
    const sel = selection('c1', 'Local', null, null, 'connection')
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
    const collSel = selection('c1', 'Local', 'shop', 'orders', 'collection')
    const fromSidebar = deriveMenuContext(quickstart, collSel, 1)
    expect(fromSidebar.hasCollection).toBe(true)
    expect(fromSidebar.hasDocument).toBe(false)
    expect(fromSidebar.hasField).toBe(false)

    // A collection tab with results but no row selected: still no document context.
    const noSelection = withRuntime({ results: [{ _id: 1 }], selectedRow: -1 })
    expect(deriveMenuContext(noSelection, null, 1).hasDocument).toBe(false)

    // A row selected enables whole-document actions but not field actions.
    const rowSelected = withRuntime({ results: [{ _id: 1 }], selectedRow: 0 })
    const rowCtx = deriveMenuContext(rowSelected, null, 1)
    expect(rowCtx.hasDocument).toBe(true)
    expect(rowCtx.hasField).toBe(false)

    // A selected field enables both.
    const fieldSelected = withRuntime({ results: [{ _id: 1 }], selectedRow: 0, selectedField: '_id' })
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

  it('enables Refresh as the active tab says, whatever the sidebar holds', () => {
    const sel = selection('c1', 'Local', 'shop', 'orders', 'collection')
    expect(deriveMenuContext(collectionTab, sel, 1, false, true).canRefreshTab).toBe(true)
    expect(deriveMenuContext(quickstart, sel, 1, false, false).canRefreshTab).toBe(false)
  })

  it('readOnly comes from the active tab, never the sidebar', () => {
    const collSel = selection('c1', 'Local', 'shop', 'orders', 'collection')
    // A locked tab locks the context even with no sidebar selection.
    expect(deriveMenuContext({ ...collectionTab, readOnly: true }, null, 1).readOnly).toBe(true)
    // An unlocked tab stays unlocked even when a sidebar node is selected.
    expect(deriveMenuContext(collectionTab, collSel, 1).readOnly).toBe(false)
    // The sidebar selection alone (Quickstart active) never locks anything.
    expect(deriveMenuContext(quickstart, collSel, 1).readOnly).toBe(false)
  })

  // A Current Operations tab carries dbName/collName as *filters*, not identity. The
  // old field-presence check read them as identity and lit the whole Database menu.
  it('does not let Current Operations filters enable the database menu', () => {
    const ops = { id: 't2', kind: 'currentOps', connId: 'c1', connName: 'Local', dbName: 'shop', collName: 'orders' }
    const ctx = deriveMenuContext(ops, null, 1)
    expect(ctx.hasConnection).toBe(true)
    expect(ctx.hasDatabase).toBe(false)
    expect(ctx.hasCollection).toBe(false)
  })

  // Schema/Indexes/Export/Import are collection-scoped workspaces, so collection
  // actions apply to them just as they do to a find tab.
  it('enables collection actions for collection-scoped tool tabs', () => {
    const schema = { id: 't3', kind: 'schema', connId: 'c1', connName: 'Local', dbName: 'shop', collName: 'orders' }
    const ctx = deriveMenuContext(schema, null, 1)
    expect(ctx.hasDatabase).toBe(true)
    expect(ctx.hasCollection).toBe(true)
  })

  it('gates everything off for a workspace kind that names no resource', () => {
    const ctx = deriveMenuContext({ id: 't4', kind: 'not-a-registered-kind', connId: 'c1' }, null, 0)
    expect(ctx.hasConnection).toBe(false)
    expect(ctx.anyConnection).toBe(false)
  })
})

// Every item behind the Connection / Database / Collection gates is a MongoDB action,
// so a PostgreSQL selection or tab must never light one up or be handed to one.
describe('PostgreSQL never reaches the MongoDB gates', () => {
  const pgConnection = selection('p1', 'Payments PG', null, null, 'connection', 'postgresql')
  const pgTableTab = {
    id: 't9', kind: 'pgTable', engine: 'postgresql',
    connectionId: 'p1', connectionName: 'Payments PG', database: 'payments', schema: 'public', table: 'merchants',
  }

  it('a PostgreSQL connection selected in the sidebar enables no connection item', () => {
    const ctx = deriveMenuContext(quickstart, pgConnection, 1)
    expect([ctx.hasConnection, ctx.hasDatabase, ctx.hasCollection]).toEqual([false, false, false])
    // Refresh still works on every open connection, whatever its engine.
    expect(ctx.anyConnection).toBe(true)
  })

  it('a PostgreSQL tab enables none of them either', () => {
    const ctx = deriveMenuContext(pgTableTab, pgConnection, 1)
    expect([ctx.hasConnection, ctx.hasDatabase, ctx.hasCollection]).toEqual([false, false, false])
  })

  it('a MongoDB tab still counts while a PostgreSQL connection is selected', () => {
    const ctx = deriveMenuContext(collectionTab, pgConnection, 2)
    expect([ctx.hasConnection, ctx.hasDatabase, ctx.hasCollection]).toEqual([true, true, true])
    expect(resolveMenuTarget(collectionTab, pgConnection, 'connection')).toMatchObject({ connectionId: 'c1' })
  })

  it('never hands a PostgreSQL connection to an action — ⌘L finds no database to open a shell on', () => {
    expect(resolveMenuTarget(quickstart, pgConnection, 'connection')).toBe(null)
    expect(resolveMenuTarget(pgTableTab, pgConnection, 'database')).toBe(null)
  })
})

describe('resolveMenuTarget', () => {
  it('prefers the sidebar selection over the active tab', () => {
    const sel = selection('c2', 'Prod', 'analytics', 'events', 'collection')
    expect(resolveMenuTarget(collectionTab, sel)).toEqual({
      connectionId: 'c2', connectionName: 'Prod', dbName: 'analytics', collectionName: 'events', kind: 'collection',
    })
  })

  // The tree always emits an explicit kind (see useConnectionTree), and that is
  // authoritative — the level is never guessed from which fields happen to be set.
  it('takes the level from the selection kind, not from field presence', () => {
    const dbSel = selection('c1', 'Local', 'shop', null, 'database')
    expect(resolveMenuTarget(null, dbSel).kind).toBe('database')
    const connSel = selection('c1', 'Local', null, null, 'connection')
    expect(resolveMenuTarget(null, connSel).kind).toBe('connection')
  })

  it('names no resource for a kindless selection rather than guessing one', () => {
    expect(resolveMenuTarget(null, { connectionId: 'c1', dbName: 'shop' })).toBe(null)
  })

  it('falls back to the active tab when nothing is selected', () => {
    expect(resolveMenuTarget(collectionTab, null)).toEqual({
      connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: 'orders', kind: 'collection',
    })
  })

  it('returns null when neither a selection nor a tab is available', () => {
    expect(resolveMenuTarget(null, null)).toBe(null)
  })

  it('falls back to the active tab when the selection is too shallow for the level', () => {
    // Collection tab active, but a bare connection is highlighted. A collection-
    // scoped action must act on the tab (which its gate lit up), not the shallow
    // selection — otherwise the enabled item would only toast a guide message.
    const connSel = selection('c2', 'Prod', null, null, 'connection')
    expect(resolveMenuTarget(collectionTab, connSel, 'collection')).toEqual({
      connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: 'orders', kind: 'collection',
    })
    // A database-scoped action likewise falls through to the collection tab.
    expect(resolveMenuTarget(collectionTab, connSel, 'database').collectionName).toBe('orders')
    // A connection-scoped action is satisfied by the selection, so it wins.
    expect(resolveMenuTarget(collectionTab, connSel, 'connection').connectionId).toBe('c2')
  })

  it('prefers the sidebar selection when it satisfies the required level', () => {
    const collSel = selection('c2', 'Prod', 'analytics', 'events', 'collection')
    expect(resolveMenuTarget(collectionTab, collSel, 'collection').connectionId).toBe('c2')
  })

  it('returns the shallow selection for the guide message when neither satisfies', () => {
    const connSel = selection('c2', 'Prod', null, null, 'connection')
    expect(resolveMenuTarget(quickstart, connSel, 'collection').connectionId).toBe('c2')
  })

  // Tool tabs spell their fields connId/collName; handlers downstream read
  // connectionId/collectionName. Resolving through ResourceRef normalises both to one
  // shape, so an action fired from a Schema tab cannot land on undefined.
  it('normalises a short-alias tool tab to the long spelling', () => {
    const schema = { id: 't3', kind: 'schema', connId: 'c1', connName: 'Local', dbName: 'shop', collName: 'orders' }
    expect(resolveMenuTarget(schema, null, 'collection')).toEqual({
      connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: 'orders', kind: 'collection',
    })
  })
})

// ozendb-sxd: the PostgreSQL gates are the union of the active tab and the sidebar
// selection, the same as the Mongo ones above — PostgresTreeNodes feeds its clicked
// schema/table row into the shared tree-selection store.
const pgQueryTab = { id: 'p1', type: 'postgresql.query', connectionId: 'c1', connectionName: 'PG', database: 'app', schema: 'public' }
const pgTableTab = { id: 'p2', type: 'postgresql.table_browse', connectionId: 'c1', connectionName: 'PG', database: 'app', schema: 'public', table: 'widgets' }

describe('deriveMenuContext (PostgreSQL)', () => {
  it('a query tab enables the schema gate only', () => {
    const ctx = deriveMenuContext(pgQueryTab, null, 0)
    expect(ctx.hasPgSchema).toBe(true)
    expect(ctx.hasPgTable).toBe(false)
  })

  it('a table tab enables both the schema and table gates', () => {
    const ctx = deriveMenuContext(pgTableTab, null, 0)
    expect(ctx.hasPgSchema).toBe(true)
    expect(ctx.hasPgTable).toBe(true)
  })

  it('a non-PostgreSQL tab, or none, enables neither', () => {
    expect(deriveMenuContext(collectionTab, null, 0).hasPgSchema).toBe(false)
    expect(deriveMenuContext(null, null, 0).hasPgSchema).toBe(false)
  })

  it('reads the table tab\'s own accidental-edit lock, nested under state', () => {
    const locked = { ...pgTableTab, state: { readOnly: true } }
    expect(deriveMenuContext(locked, null, 0).readOnly).toBe(true)
    expect(deriveMenuContext(pgTableTab, null, 0).readOnly).toBe(false)
  })
})

// Built the way PostgresTreeNodes builds them, so these cannot drift from the runtime
// payload — the PostgreSQL levels name their own fields (database/schema/table).
function pgSelection(kind, fields) {
  const sel = {
    connectionId: 'c1', connectionName: 'PG', engine: 'postgresql',
    database: null, schema: null, table: null, kind, ...fields,
  }
  return { ...sel, resource: resourceFromTreeSelection(sel) }
}

describe('deriveMenuContext (PostgreSQL sidebar selection)', () => {
  it('a selected schema enables the schema gate with no tab open', () => {
    const ctx = deriveMenuContext(quickstart, pgSelection('schema', { database: 'app', schema: 'public' }), 1)
    expect(ctx.hasPgSchema).toBe(true)
    expect(ctx.hasPgTable).toBe(false)
  })

  it('a selected table enables both gates with no tab open', () => {
    const ctx = deriveMenuContext(quickstart, pgSelection('table', { database: 'app', schema: 'public', table: 'widgets' }), 1)
    expect(ctx.hasPgSchema).toBe(true)
    expect(ctx.hasPgTable).toBe(true)
  })

  it('a shallower PostgreSQL selection enables neither', () => {
    const connSel = pgSelection('connection', {})
    expect(deriveMenuContext(quickstart, connSel, 1).hasPgSchema).toBe(false)
    expect(deriveMenuContext(quickstart, connSel, 1).hasPgTable).toBe(false)
  })

  // A Mongo collection is two segments deep, as a Postgres schema is — the engine is
  // what separates them, not the depth.
  it('a MongoDB selection never enables the PostgreSQL gates', () => {
    const ctx = deriveMenuContext(quickstart, selection('c1', 'Local', 'shop', 'orders', 'collection'), 1)
    expect(ctx.hasPgSchema).toBe(false)
    expect(ctx.hasPgTable).toBe(false)
  })

  // The mirror of the Mongo rule: a Postgres tab must not light up the Mongo gates.
  it('a PostgreSQL selection never enables the MongoDB gates', () => {
    const ctx = deriveMenuContext(quickstart, pgSelection('table', { database: 'app', schema: 'public', table: 'widgets' }), 1)
    expect(ctx.hasDatabase).toBe(false)
    expect(ctx.hasCollection).toBe(false)
  })
})

describe('resolvePgMenuTarget', () => {
  it('resolves a query tab, carrying both alias spellings', () => {
    expect(resolvePgMenuTarget(pgQueryTab)).toEqual({
      connId: 'c1', connName: 'PG', connectionId: 'c1', connectionName: 'PG',
      database: 'app', schema: 'public', table: null,
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
      connId: 'c1', connName: 'PG', connectionId: 'c1', connectionName: 'PG',
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
      connId: 'c1', connName: 'PG', connectionId: 'c1', connectionName: 'PG',
      database: 'app', schema: 'public', table: null,
    })
  })

  it('is null when neither the tab nor the selection is PostgreSQL', () => {
    expect(resolvePgMenuTarget(collectionTab, selection('c1', 'Local', 'shop', 'orders', 'collection'), 'schema')).toBeNull()
  })
})

describe('deriveMenuContext engine (ozendb-izk)', () => {
  const mongoTab = { ...collectionTab, engine: 'mongodb' }
  const pgTab = { ...pgTableTab, engine: 'postgresql' }

  it("is 'none' with nothing to name an engine, so neither engine's items show", () => {
    expect(deriveMenuContext({ ...quickstart, engine: 'app' }, null, 0).engine).toBe('none')
    expect(deriveMenuContext(null, null, 0).engine).toBe('none')
  })

  it('reads the active tab when nothing is selected in the sidebar', () => {
    expect(deriveMenuContext(mongoTab, null, 1).engine).toBe('mongodb')
    expect(deriveMenuContext(pgTab, null, 1).engine).toBe('postgresql')
  })

  it('follows a sidebar selection that enables something when the tab names no engine', () => {
    const app = { ...quickstart, engine: 'app' }
    const pgSel = pgSelection('table', { database: 'app', schema: 'public', table: 'widgets' })
    expect(deriveMenuContext(app, pgSel, 1).engine).toBe('postgresql')
    expect(deriveMenuContext(app, selection('c1', 'Local', 'shop', 'orders', 'collection'), 1).engine).toBe('mongodb')
  })

  it('ignores a PostgreSQL selection too shallow to enable anything', () => {
    // Clicking a connection or database row to expand it must not hide the open
    // MongoDB tab's items: no PostgreSQL item enables below a schema.
    const pgConn = pgSelection('connection', {})
    const pgDb = pgSelection('database', { database: 'app' })
    expect(deriveMenuContext(mongoTab, pgConn, 2).engine).toBe('mongodb')
    expect(deriveMenuContext(mongoTab, pgDb, 2).engine).toBe('mongodb')
    expect(deriveMenuContext({ ...quickstart, engine: 'app' }, pgDb, 1).engine).toBe('none')
  })

  it('lets a live selection win over a tab of the other engine', () => {
    const pgSel = pgSelection('table', { database: 'app', schema: 'public', table: 'widgets' })
    expect(deriveMenuContext(mongoTab, pgSel, 2).engine).toBe('postgresql')
    expect(deriveMenuContext(pgTab, selection('c1', 'Local', null, null, 'connection'), 2).engine).toBe('mongodb')
  })

  it('agrees with a live selection of the same engine as the tab', () => {
    const pgSel = pgSelection('schema', { database: 'app', schema: 'public' })
    expect(deriveMenuContext(pgTab, pgSel, 1).engine).toBe('postgresql')
  })

  it('treats a selection with no engine as MongoDB, like the gates do', () => {
    const legacy = { ...selection('c1', 'Local', 'shop', 'orders', 'collection'), engine: undefined }
    expect(deriveMenuContext({ ...quickstart, engine: 'app' }, legacy, 1).engine).toBe('mongodb')
  })

  it("is 'none' for an engine the menu has no items for", () => {
    expect(deriveMenuContext({ ...mongoTab, engine: 'mysql' }, null, 1).engine).toBe('none')
  })
})

// ozendb-7dz: a write action aimed at the sidebar selection must respect the lock of an
// open tab on that same resource, not only the active tab's.
describe('deriveMenuContext read-only for a sidebar target', () => {
  const app = { ...quickstart, engine: 'app' }
  const orders = { connectionId: 'c1', segments: [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }] }
  const users = { connectionId: 'c1', segments: [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'users' }] }
  const widgets = {
    connectionId: 'c1',
    segments: [{ kind: 'database', name: 'app' }, { kind: 'schema', name: 'public' }, { kind: 'table', name: 'widgets' }],
  }
  const ordersSel = selection('c1', 'Local', 'shop', 'orders', 'collection')
  const widgetsSel = pgSelection('table', { database: 'app', schema: 'public', table: 'widgets' })

  it('locks when an open tab on the selected collection is locked', () => {
    const locked = { id: 'x', target: orders, readOnly: true }
    expect(deriveMenuContext(app, ordersSel, 1, false, false, [app, locked]).readOnly).toBe(true)
  })

  it('locks when an open PostgreSQL tab on the selected table is locked', () => {
    const locked = { id: 'p', target: widgets, state: { readOnly: true } }
    expect(deriveMenuContext(app, widgetsSel, 1, false, false, [app, locked]).readOnly).toBe(true)
  })

  it('stays unlocked when the selected resource has no locked tab', () => {
    const unlocked = { id: 'x', target: orders, readOnly: false }
    const lockedElsewhere = { id: 'y', target: users, readOnly: true }
    expect(deriveMenuContext(app, ordersSel, 1, false, false, [app, unlocked, lockedElsewhere]).readOnly).toBe(false)
  })

  it('ignores open tabs when nothing is selected', () => {
    const locked = { id: 'x', target: orders, readOnly: true }
    expect(deriveMenuContext(app, null, 1, false, false, [app, locked]).readOnly).toBe(false)
  })
})
