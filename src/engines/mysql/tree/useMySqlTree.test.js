import { describe, it, expect, vi, beforeEach } from 'vitest'

const listTables = vi.fn()
const listColumns = vi.fn()
vi.mock('../api/resources', () => ({ listTables, listColumns }))

const { useMySqlTree, visibleDatabases, columnRow } = await import('./useMySqlTree.js')

beforeEach(() => vi.resetAllMocks())

const shop = 'shop `eu` ü'

describe('visibleDatabases', () => {
  const databases = [{ name: 'mysql', system: true }, { name: shop, system: false }]

  it('hides MySQL\'s own databases', () => {
    expect(visibleDatabases(databases, false)).toEqual([{ name: shop, system: false }])
  })

  it('shows them too when asked', () => {
    expect(visibleDatabases(databases, true)).toEqual(databases)
  })
})

describe('columnRow', () => {
  const column = { name: 'buyer id', dataType: 'int', nullable: true, isPrimaryKey: false, default: null, references: null }

  it('names a referenced column in the same database by its table', () => {
    const references = { database: shop, table: 'клиенты ü', column: 'id key' }
    expect(columnRow({ ...column, references }, shop).references).toBe('клиенты ü.id key')
  })

  it('names a referenced column in another database by that database too', () => {
    const references = { database: 'crm.eu', table: 'people', column: 'id' }
    expect(columnRow({ ...column, references }, shop).references).toBe('crm.eu.people.id')
  })

  it('keeps the type, key and nullability the sidebar shows', () => {
    expect(columnRow({ ...column, isPrimaryKey: true }, shop))
      .toEqual({ name: 'buyer id', dataType: 'int', primaryKey: true, references: null, nullable: true })
  })
})

describe('useMySqlTree', () => {
  it('reads a database\'s tables the first time it opens, not again', async () => {
    listTables.mockResolvedValue([{ name: 'order items', kind: 'table', estimatedRows: 12 }])
    const tree = useMySqlTree('c1')
    await tree.toggleDatabase(shop)
    await tree.toggleDatabase(shop)
    await tree.toggleDatabase(shop)
    expect(listTables).toHaveBeenCalledTimes(1)
    expect(listTables).toHaveBeenCalledWith({ connectionId: 'c1', database: shop })
    expect(tree.tables.value[shop]).toEqual([{ name: 'order items', kind: 'table', estimatedRows: 12 }])
    expect(tree.openDatabases.value[shop]).toBe(true)
  })

  it('closes a database whose tables fail to load, with the reason', async () => {
    listTables.mockRejectedValue({ code: 'forbidden', message: 'Access denied for user to database' })
    const tree = useMySqlTree('c1')
    await tree.toggleDatabase(shop)
    expect(tree.openDatabases.value[shop]).toBe(false)
    expect(tree.errors.value[shop]).toBe('Access denied for user to database')
  })

  it('reads a table\'s columns when its folder opens', async () => {
    listColumns.mockResolvedValue([
      { name: 'id', dataType: 'bigint unsigned', nullable: false, isPrimaryKey: true, default: null, references: null },
    ])
    const tree = useMySqlTree('c1')
    await tree.toggleTable(shop, 'order items')
    expect(listColumns).toHaveBeenCalledWith({ connectionId: 'c1', database: shop, table: 'order items' })
    expect(tree.isTableOpen(shop, 'order items')).toBe(true)
    expect(tree.columnsOf(shop, 'order items')[0].dataType).toBe('bigint unsigned')
    expect(tree.columnsOf(shop, 'order')).toBeNull()
  })

  it('re-reads the open databases\' tables on a refresh, and forgets the closed ones', async () => {
    listTables.mockResolvedValue([])
    const tree = useMySqlTree('c1')
    await tree.toggleDatabase(shop)
    await tree.toggleDatabase('crm')
    await tree.toggleDatabase('crm')
    await tree.reloadTables()
    expect(listTables).toHaveBeenCalledTimes(3)
    expect(listTables).toHaveBeenLastCalledWith({ connectionId: 'c1', database: shop })
    expect(tree.tables.value.crm).toBeUndefined()
  })

  it('forgets a table\'s column error on a refresh, as it forgets the table\'s columns', async () => {
    listTables.mockResolvedValue([])
    listColumns.mockRejectedValueOnce(new Error('SELECT command denied'))
    const tree = useMySqlTree('c1')
    await tree.toggleTable(shop, 'orders')
    expect(tree.tableError(shop, 'orders')).toBe('SELECT command denied')
    await tree.reloadTables()
    expect(tree.tableError(shop, 'orders')).toBeNull()
  })
})
