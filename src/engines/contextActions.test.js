import { describe, it, expect, vi } from 'vitest'

vi.mock('../stores/modals', () => ({ openModal: vi.fn() }))
vi.mock('../stores/tabCreators', () => ({ openPostgresQuery: vi.fn(), openPostgresTable: vi.fn() }))

const { contextAction, connectionMenu } = await import('./contextActions.js')
const { PG_ACTIONS, PG_MENUS } = await import('./postgresql/tree/contextMenus.js')

describe('contextAction', () => {
  it('finds an engine\'s own handler for a node of that engine', () => {
    expect(contextAction({ engine: 'postgresql' }, 'Server Info')).toBe(PG_ACTIONS['Server Info'])
  })

  it('leaves everything else to the shared dispatcher', () => {
    expect(contextAction({ engine: 'mongodb' }, 'Server Info')).toBe(null)
    expect(contextAction({}, 'Server Info')).toBe(null)
    expect(contextAction(undefined, 'Server Info')).toBe(null)
    expect(contextAction({ engine: 'postgresql' }, 'Open Collection')).toBe(null)
  })
})

describe('connectionMenu', () => {
  it('gives a PostgreSQL connection its own menu, defaulting the database', () => {
    const menu = connectionMenu({ id: 'c1', name: 'pg', engine: 'postgresql' })
    expect(menu.node).toEqual({ connId: 'c1', connName: 'pg', engine: 'postgresql', database: 'postgres' })
    expect(menu.items).toBe(PG_MENUS.connection)
    expect(connectionMenu({ id: 'c1', name: 'pg', engine: 'postgresql', database: 'shop' }).node.database).toBe('shop')
  })

  it('has none for MongoDB, which uses the shared connection menu', () => {
    expect(connectionMenu({ id: 'c1', name: 'm', engine: 'mongodb' })).toBe(null)
    expect(connectionMenu({ id: 'c1', name: 'm' })).toBe(null)
  })
})
