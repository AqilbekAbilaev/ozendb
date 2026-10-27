import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createResourceRef } from '../../utils/resourceRef'

const openPostgresQuery = vi.fn()
const openPostgresSearch = vi.fn()
vi.mock('./tabs', () => ({ openPostgresQuery, openPostgresSearch }))
const openModal = vi.fn()
vi.mock('../../stores/modals', () => ({ openModal }))
const treeSelection = { value: null }
vi.mock('../../stores/connectionNavigation', () => ({ treeSelection }))
const activeTab = { value: null }
vi.mock('../../stores/tabs', () => ({ activeTab }))

const { runPgMenuAction } = await import('./menuActions.js')

// Built the way PostgresTreeNodes builds a selection: one segment per level clicked.
const pgSel = (...names) => ({
  engine: 'postgresql', connectionName: 'Payments PG',
  resource: createResourceRef('p 1', names.map((name, i) => ({ kind: ['database', 'schema', 'table'][i], name }))),
})
const target = (database, schema, table) => ({
  connId: 'p 1', engine: 'postgresql', connName: 'Payments PG', connectionId: 'p 1', connectionName: 'Payments PG',
  database, schema, table,
})

beforeEach(() => {
  vi.clearAllMocks()
  treeSelection.value = null
  activeTab.value = null
})

describe('PostgreSQL menu coverage', () => {
  it('claims every PostgreSQL item', () => {
    const items = ['pg:new_sql', 'pg:create_table', 'pg:search_schema', 'pg:row_history', 'pg:drop_table']
    expect(items.filter((id) => !runPgMenuAction(id))).toEqual([])
  })

  it('leaves every other item to others', () => {
    expect(['coll:vqb', 'view:zoom_in', 'file:sql'].filter(runPgMenuAction)).toEqual([])
  })
})

describe('runPgMenuAction', () => {
  it('opens a SQL tab on the database of the schema in focus', () => {
    treeSelection.value = pgSel('app.db', 'püblic')
    runPgMenuAction('pg:new_sql')
    expect(openPostgresQuery).toHaveBeenCalledWith({ connectionId: 'p 1', connectionName: 'Payments PG', database: 'app.db' })
  })

  it('opens Search in Schema on the schema in focus', () => {
    treeSelection.value = pgSel('app.db', 'püblic')
    runPgMenuAction('pg:search_schema')
    expect(openPostgresSearch).toHaveBeenCalledWith({
      connectionId: 'p 1', connectionName: 'Payments PG', database: 'app.db', schema: 'püblic',
    })
  })

  it('drops the table in focus', () => {
    treeSelection.value = pgSel('app.db', 'püblic', 'order lines')
    runPgMenuAction('pg:drop_table')
    expect(openModal).toHaveBeenCalledWith('pgDrop', target('app.db', 'püblic', 'order lines'))
  })

  it('does nothing for a table item when only a schema is in focus', () => {
    treeSelection.value = pgSel('app.db', 'püblic')
    runPgMenuAction('pg:drop_table')
    expect(openModal).not.toHaveBeenCalled()
  })

  it('does nothing when nothing PostgreSQL is in focus', () => {
    expect(runPgMenuAction('pg:create_table')).toBe(true)
    expect(openModal).not.toHaveBeenCalled()
  })
})
