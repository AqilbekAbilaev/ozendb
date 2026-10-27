import { describe, it, expect, vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

// The tab store builds its first tab from the registered definitions, so it is loaded
// after they are (see stores/tabCreators.test.js).
import { registerWorkspaceDefinitions } from '../../workspaces/registerDefinitions'
registerWorkspaceDefinitions()

const openers = await import('./tabs')
const { tabs, activeTabId } = await import('../../stores/tabs')

function harness() {
  tabs.value = [{ id: 't0', type: 'app.quickstart', title: 'Quickstart' }]
  activeTabId.value = 't0'
  return openers
}

const lastTab = () => tabs.value[tabs.value.length - 1]

describe('PostgreSQL tables', () => {
  const TABLE = { connectionId: 'c9', connectionName: 'pg', database: 'app', schema: 'public', table: 'users' }

  it('opens a table-browse tab on every open, like a collection, and activates it', () => {
    const c = harness()
    c.openPostgresTable(TABLE)
    c.openPostgresTable(TABLE)

    expect(tabs.value.filter(t => t.type === 'postgresql.table_browse')).toHaveLength(2)
    expect(lastTab()).toMatchObject({ type: 'postgresql.table_browse', engine: 'postgresql', title: 'users' })
    expect(lastTab().target.segments).toEqual([{ kind: 'database', name: 'app' }, { kind: 'schema', name: 'public' }, { kind: 'table', name: 'users' }])
    expect(activeTabId.value).toBe(lastTab().id)
  })

  it('opens filtered to one row when given its primary key', () => {
    const c = harness()
    c.openPostgresTable({ ...TABLE, rowKey: { id: 7 } })
    expect(lastTab().state.query.filters).toEqual([{ key: 'id', op: 'eq', value: '7' }])
  })
})

describe('PostgreSQL search', () => {
  it('opens a search tab on the schema, every time, and activates it', () => {
    const c = harness()
    const SCHEMA = { connectionId: 'c9', connectionName: 'pg', database: 'app', schema: 'public' }
    c.openPostgresSearch(SCHEMA)
    c.openPostgresSearch(SCHEMA)
    expect(tabs.value.filter(t => t.type === 'postgresql.search')).toHaveLength(2)
    expect(lastTab()).toMatchObject({ type: 'postgresql.search', engine: 'postgresql', title: 'Search: public' })
    expect(lastTab().target.segments).toEqual([{ kind: 'database', name: 'app' }, { kind: 'schema', name: 'public' }])
    expect(activeTabId.value).toBe(lastTab().id)
  })
})

describe('PostgreSQL queries', () => {
  it('opens a query tab against the connection\'s database, and activates it', () => {
    const c = harness()
    c.openPostgresQuery({ connectionId: 'c9', connectionName: 'pg', database: 'app' })
    expect(lastTab()).toMatchObject({ type: 'postgresql.query', state: { sql: '' } })
    expect(lastTab().target.segments).toEqual([{ kind: 'database', name: 'app' }])
    expect(activeTabId.value).toBe(lastTab().id)
  })
})
