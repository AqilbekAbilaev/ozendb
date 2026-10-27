import { describe, it, expect } from 'vitest'
import { postgresqlMenu, resolvePgMenuTarget } from './menu'
import { createResourceRef } from '../../utils/resourceRef'

// Built the way PostgresTreeNodes builds a selection: one segment per level clicked.
const pgSel = (...names) => ({
  engine: 'postgresql',
  resource: createResourceRef('pg 1', names.map((name, i) => ({ kind: ['database', 'schema', 'table'][i], name }))),
})

describe('postgresqlMenu.selectionEnables', () => {
  it('is true from a schema down', () => {
    expect(postgresqlMenu.selectionEnables(pgSel('app.db', 'püblic'))).toBe(true)
    expect(postgresqlMenu.selectionEnables(pgSel('app.db', 'püblic', 'order lines'))).toBe(true)
  })

  it('is false for a connection or database row, or no selection', () => {
    expect(postgresqlMenu.selectionEnables(pgSel())).toBe(false)
    expect(postgresqlMenu.selectionEnables(pgSel('app.db'))).toBe(false)
    expect(postgresqlMenu.selectionEnables(null)).toBe(false)
  })

  it('is false for a MongoDB selection of the same depth', () => {
    expect(postgresqlMenu.selectionEnables({ ...pgSel('shop', 'orders'), engine: 'mongodb' })).toBe(false)
  })
})

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
const quickstart = { id: 't0', type: 'app.quickstart', title: 'Quickstart' }
const collectionTab = {
  id: 't1', type: 'mongodb.find', connectionName: 'Local',
  target: createResourceRef('c1', [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }]),
}
const mongoSelection = {
  engine: 'mongodb', connectionName: 'Local',
  resource: createResourceRef('c1', [{ kind: 'database', name: 'shop' }, { kind: 'collection', name: 'orders' }]),
}

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

  // Same precedence rule as MongoDB's resolveMenuTarget: the sidebar selection wins when
  // it is deep enough for the action, since that is what the user just clicked.
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
    expect(resolvePgMenuTarget(collectionTab, mongoSelection, 'schema')).toBeNull()
  })
})
