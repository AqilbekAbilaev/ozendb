import { describe, it, expect } from 'vitest'
import { mongoMenu, resolveMenuTarget } from './menu'
import { createResourceRef } from '../../utils/resourceRef'

const ref = createResourceRef('c 1', [{ kind: 'database', name: 'shop/eu' }])

describe('mongoMenu.selectionEnables', () => {
  it('is true for any MongoDB row, a connection included', () => {
    expect(mongoMenu.selectionEnables({ engine: 'mongodb', resource: createResourceRef('c 1', []) })).toBe(true)
    expect(mongoMenu.selectionEnables({ engine: 'mongodb', resource: ref })).toBe(true)
  })

  it('treats a selection with no engine as MongoDB', () => {
    expect(mongoMenu.selectionEnables({ resource: ref })).toBe(true)
  })

  it("is false for another engine's row, or no selection", () => {
    expect(mongoMenu.selectionEnables({ engine: 'postgresql', resource: ref })).toBe(false)
    expect(mongoMenu.selectionEnables(null)).toBe(false)
  })
})

describe('mongoMenu.tabNamesConnection', () => {
  it('is true for a MongoDB tab naming a resource', () => {
    expect(mongoMenu.tabNamesConnection({ type: 'mongodb.find', target: ref })).toBe(true)
  })

  it('is false for a tab naming no resource, or another engine\'s tab', () => {
    expect(mongoMenu.tabNamesConnection({ type: 'app.quickstart' })).toBe(false)
    expect(mongoMenu.tabNamesConnection({ engine: 'postgresql', target: ref })).toBe(false)
  })
})

// A tab's identity is the `target` its definition gives it; these mirror those.
function tabRef(connectionId, dbName, collectionName) {
  const segments = []
  if (dbName) segments.push({ kind: 'database', name: dbName })
  if (collectionName) segments.push({ kind: 'collection', name: collectionName })
  return createResourceRef(connectionId, segments)
}

// Selections are built exactly the way useConnectionTree builds them, so these
// fixtures cannot drift from the payload the menu actually receives at runtime.
function selection(connectionId, connectionName, dbName, collectionName, engine = 'mongodb') {
  return { resource: tabRef(connectionId, dbName, collectionName), connectionName, engine }
}

const quickstart = { id: 't0', type: 'app.quickstart', title: 'Quickstart' }
const collectionTab = {
  id: 't1', type: 'mongodb.find', target: tabRef('c1', 'shop', 'orders'),
  connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: 'orders',
  runtime: { results: [], selectedRow: -1, selectedField: null },
}

// Every item behind the Connection / Database / Collection gates is a MongoDB action,
// so a PostgreSQL selection or tab must never be handed to one.
describe('resolveMenuTarget never resolves to PostgreSQL', () => {
  const pgConnection = selection('p1', 'Payments PG', null, null, 'postgresql')
  const pgTableTab = {
    id: 't9', type: 'postgresql.table_browse', engine: 'postgresql',
    target: createResourceRef('p1', [{ kind: 'database', name: 'payments' }, { kind: 'schema', name: 'public' }, { kind: 'table', name: 'merchants' }]),
    connectionName: 'Payments PG',
  }

  it('a MongoDB tab still counts while a PostgreSQL connection is selected', () => {
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
      resource: tabRef('c2', 'analytics', 'events'), connectionName: 'Prod',
    })
  })

  // The tree builds the selection's ref (see useConnectionTree), and that is
  // authoritative — the level is never guessed from which fields happen to be set.
  it('takes the level from the selection\'s ref', () => {
    const dbSel = selection('c1', 'Local', 'shop', null)
    expect(resolveMenuTarget(null, dbSel).resource).toEqual(tabRef('c1', 'shop'))
    const connSel = selection('c1', 'Local', null, null)
    expect(resolveMenuTarget(null, connSel).resource).toEqual(tabRef('c1'))
  })

  it('names no resource for a selection without a ref rather than guessing one', () => {
    expect(resolveMenuTarget(null, { connectionId: 'c1', dbName: 'shop' })).toBe(null)
  })

  it('falls back to the active tab when nothing is selected', () => {
    expect(resolveMenuTarget(collectionTab, null)).toEqual({
      resource: tabRef('c1', 'shop', 'orders'), connectionName: 'Local',
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
      resource: tabRef('c1', 'shop', 'orders'), connectionName: 'Local',
    })
    // A database-scoped action likewise falls through to the collection tab.
    expect(resolveMenuTarget(collectionTab, connSel, 'database').resource).toEqual(tabRef('c1', 'shop', 'orders'))
    // A connection-scoped action is satisfied by the selection, so it wins.
    expect(resolveMenuTarget(collectionTab, connSel, 'connection').resource).toEqual(tabRef('c2'))
  })

  it('prefers the sidebar selection when it satisfies the required level', () => {
    const collSel = selection('c2', 'Prod', 'analytics', 'events')
    expect(resolveMenuTarget(collectionTab, collSel, 'collection').resource).toEqual(tabRef('c2', 'analytics', 'events'))
  })

  it('returns the shallow selection for the guide message when neither satisfies', () => {
    const connSel = selection('c2', 'Prod', null, null)
    expect(resolveMenuTarget(quickstart, connSel, 'collection').resource).toEqual(tabRef('c2'))
  })

  // A tool tab resolves through its target, like every other tab.
  it('resolves a tool tab through its target', () => {
    const schema = { id: 't3', type: 'mongodb.schema', target: tabRef('c1', 'shop', 'orders'), connectionId: 'c1', connectionName: 'Local', dbName: 'shop', collectionName: 'orders' }
    expect(resolveMenuTarget(schema, null, 'collection')).toEqual({
      resource: tabRef('c1', 'shop', 'orders'), connectionName: 'Local',
    })
  })
})
