import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

// The tab store builds its first tab from the registered definitions, so it is loaded
// after they are (see stores/tabCreators.test.js).
import { registerWorkspaceDefinitions } from '../../../workspaces/registerDefinitions'
registerWorkspaceDefinitions()

const { MYSQL_MENUS, MYSQL_ACTIONS } = await import('./contextMenus.js')
const { contextAction } = await import('../../contextActions.js')
const { createResourceRef } = await import('../../../utils/resourceRef')
const { tabs, activeTabId } = await import('../../../stores/tabs')
const { openModals, closeModal } = await import('../../../stores/modals')
const { MODALS } = await import('../../../constants/modalRegistry')

const resource = createResourceRef('m1', [{ kind: 'database', name: 'shop `2024` ü' }, { kind: 'table', name: 'order items' }])
const table = { connId: 'm1', connName: 'Shop MySQL', engine: 'mysql', resource }

beforeEach(() => {
  tabs.value = []
  activeTabId.value = null
  for (const id of Object.keys(openModals)) closeModal(id)
})

const openedTab = () => tabs.value.at(-1)

// A server tool is offered on a connection only, and opens its registered modal there.
function expectAServerTool(action, modal) {
  const connection = { connId: 'm1', connName: 'Shop MySQL ü', engine: 'mysql', resource: createResourceRef('m1', []) }
  expect(MYSQL_MENUS.connection.map(item => item.value)).toContain(action)
  expect(MYSQL_MENUS.database.map(item => item.value)).not.toContain(action)
  MYSQL_ACTIONS[action](connection)
  expect([Object.keys(openModals), openModals[modal], MODALS[modal]?.level]).toEqual([[modal], connection, 'connection'])
}

describe('MySQL right-click menus', () => {
  it('offers to open a table from its row', () => {
    expect(MYSQL_MENUS.table.map(item => item.value)).toContain('mysql:open_table')
  })

  it('opens the table it was opened on, by its ref', () => {
    MYSQL_ACTIONS['mysql:open_table'](table)
    expect([openedTab().type, openedTab().target]).toEqual(['mysql.table_browse', resource])
  })

  it('offers a SQL query on the connection, a database and a table', () => {
    for (const level of ['connection', 'database', 'table']) expect(MYSQL_MENUS[level].map(item => item.value)).toContain('mysql:new_sql')
  })

  it('opens a SQL query on the row it was opened on, by its ref', () => {
    MYSQL_ACTIONS['mysql:new_sql'](table)
    expect([openedTab().type, openedTab().title, openedTab().target.segments]).toEqual(['mysql.query', 'SQL: shop `2024` ü', [{ kind: 'database', name: 'shop `2024` ü' }]])
  })

  it('offers to open a view as a table, and a SQL query on it', () => {
    expect(MYSQL_MENUS.view.map(item => item.value)).toEqual(expect.arrayContaining(['mysql:open_table', 'mysql:new_sql', 'node:copy_name']))
  })

  it('offers a SQL query and its name on a stored program\'s row, but nothing that would open it as a table', () => {
    const offered = MYSQL_MENUS.program.map(item => item.value)
    expect(offered).toEqual(expect.arrayContaining(['mysql:new_sql', 'node:copy_name']))
    expect(offered).not.toContain('mysql:open_table')
  })

  it('offers the definition of a view and of a stored program, but not of a table', () => {
    expect(MYSQL_MENUS.view.map(item => item.value)).toContain('mysql:definition')
    expect(MYSQL_MENUS.program.map(item => item.value)).toContain('mysql:definition')
    expect(MYSQL_MENUS.table.map(item => item.value)).not.toContain('mysql:definition')
  })

  it('shows a definition for the row it was opened on, in a modal the registry knows', () => {
    const event = { ...table, kind: 'event', resource: createResourceRef('m1', [{ kind: 'database', name: 'shop' }, { kind: 'event', name: 'nightly ü' }]) }
    MYSQL_ACTIONS['mysql:definition'](event)
    expect(Object.keys(openModals)).toEqual(['mysqlDefinition'])
    expect(MODALS.mysqlDefinition).toBeDefined()
    expect(openModals.mysqlDefinition).toEqual(event)
  })

  it('offers Users… on a connection, opening its accounts there', () => {
    expectAServerTool('mysql:users', 'mysqlUsers')
  })

  it('offers Server Activity… on a connection, opening its processes there', () => {
    expectAServerTool('mysql:activity', 'mysqlActivity')
  })

  it('is the action the engine table finds for a MySQL node', () => {
    expect(contextAction(table, 'mysql:open_table')).toBe(MYSQL_ACTIONS['mysql:open_table'])
  })
})
