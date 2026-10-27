import { describe, it, expect, vi } from 'vitest'

vi.mock('../stores/modals', () => ({ openModal: vi.fn() }))
vi.mock('./postgresql/tabs', () => ({ openPostgresQuery: vi.fn(), openPostgresTable: vi.fn() }))

const { contextAction, connectionMenu, useEngineActions, runEngineTool, runEngineMenuAction, levelledMenuTarget } = await import('./contextActions.js')
const { setTreeSelection } = await import('../stores/connectionNavigation')
const { PG_ACTIONS, PG_MENUS } = await import('./postgresql/tree/contextMenus.js')
const { MYSQL_MENUS } = await import('./mysql/tree/contextMenus.js')

describe('contextAction', () => {
  it('finds an engine\'s own handler for a node of that engine', () => {
    expect(contextAction({ engine: 'postgresql' }, 'pg:server_info')).toBe(PG_ACTIONS['pg:server_info'])
  })

  it('leaves everything else to the shared dispatcher', () => {
    expect(contextAction({ engine: 'mongodb' }, 'pg:server_info')).toBe(null)
    expect(contextAction({}, 'pg:server_info')).toBe(null)
    expect(contextAction(undefined, 'pg:server_info')).toBe(null)
    expect(contextAction({ engine: 'postgresql' }, 'coll:open_tab')).toBe(null)
  })
})

describe('connectionMenu', () => {
  it('gives a PostgreSQL connection its own menu, defaulting the database', () => {
    const menu = connectionMenu({ id: 'c1', name: 'pg', engine: 'postgresql' })
    expect(menu.node).toEqual({
      connId: 'c1', connName: 'pg', engine: 'postgresql', database: 'postgres', resource: { connectionId: 'c1', segments: [] },
    })
    expect(menu.items).toBe(PG_MENUS.connection)
    expect(connectionMenu({ id: 'c1', name: 'pg', engine: 'postgresql', database: 'shop' }).node.database).toBe('shop')
  })

  it('gives a MySQL connection its own menu, with no database when none was named', () => {
    const menu = connectionMenu({ id: 'c 1', name: 'Sales · MySQL', engine: 'mysql', database: '' })
    expect(menu.node).toEqual({
      connId: 'c 1', connName: 'Sales · MySQL', engine: 'mysql', database: null, resource: { connectionId: 'c 1', segments: [] },
    })
    expect(menu.items).toBe(MYSQL_MENUS.connection)
    expect(connectionMenu({ id: 'c 1', name: 'Sales · MySQL', engine: 'mysql', database: 'продажи' }).node.database).toBe('продажи')
  })

  it('has none for MongoDB, which uses the shared connection menu', () => {
    expect(connectionMenu({ id: 'c1', name: 'm', engine: 'mongodb' })).toBe(null)
    expect(connectionMenu({ id: 'c1', name: 'm' })).toBe(null)
  })
})

describe('useEngineActions', () => {
  it('includes MongoDB\'s actions, each with the level it needs', () => {
    const actions = useEngineActions()
    expect(actions['coll:stats'].requires).toBe('collection')
    expect(actions['file:intellishell'].requires).toBe('database')
  })
})

const shop = { connectionId: 'c 1', segments: [{ kind: 'database', name: 'магазин' }] }

describe('runEngineTool', () => {
  it('reports a tool no engine has', () => {
    expect(runEngineTool('no such tool', { runFeature: vi.fn() })).toBe(false)
  })
})

// A native-menu item resolves its node through its engine, from the sidebar selection.
describe('runEngineMenuAction', () => {
  it('reports an item no engine has', () => {
    expect(runEngineMenuAction('view:zoom_in', { runFeature: vi.fn() })).toBe(false)
  })

  it('hands an engine\'s aliased tool to the shared dispatcher, on the node it resolves', () => {
    setTreeSelection({ resource: shop, connectionName: 'Sales', engine: 'mongodb' })
    const runFeature = vi.fn()
    expect(runEngineMenuAction('file:search', { runFeature: runFeature })).toBe(true)
    expect(runFeature).toHaveBeenCalledWith('file:search', shop, { connectionName: 'Sales' })
    setTreeSelection(null)
  })
})

describe('levelledMenuTarget', () => {
  it('resolves the node an id-dispatched action runs on', () => {
    setTreeSelection({ resource: shop, connectionName: 'Sales', engine: 'mongodb' })
    expect(levelledMenuTarget('database')).toEqual({ resource: shop, connectionName: 'Sales' })
    setTreeSelection(null)
  })
})
