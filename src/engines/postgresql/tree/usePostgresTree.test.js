import { describe, it, expect, vi, beforeEach } from 'vitest'

const listTables = vi.fn()
const listColumns = vi.fn()
const listForeignKeys = vi.fn()
vi.mock('../api/resources', () => ({ listTables, listColumns, listForeignKeys }))

const { usePostgresTree, visibleSchemas, isOpenTable } = await import('./usePostgresTree.js')

beforeEach(() => vi.resetAllMocks())

describe('visibleSchemas', () => {
  it('hides PostgreSQL\'s own schemas', () => {
    const schemas = [{ name: 'pg_catalog', system: true }, { name: 'public', system: false }]
    expect(visibleSchemas(schemas)).toEqual([{ name: 'public', system: false }])
  })

  it('shows them too when asked', () => {
    const schemas = [{ name: 'pg_catalog', system: true }, { name: 'public', system: false }]
    expect(visibleSchemas(schemas, true)).toEqual(schemas)
  })
})

describe('isOpenTable', () => {
  const tab = { type: 'postgresql.table_browse', connectionId: 'c1', schema: 'public', table: 'users' }
  it('is the table the active tab is browsing, on this connection', () => {
    expect(isOpenTable(tab, 'c1', 'public', 'users')).toBe(true)
    expect(isOpenTable(tab, 'c2', 'public', 'users')).toBe(false)
    expect(isOpenTable(tab, 'c1', 'audit', 'users')).toBe(false)
    expect(isOpenTable({ ...tab, type: 'postgresql.query' }, 'c1', 'public', 'users')).toBe(false)
    expect(isOpenTable(null, 'c1', 'public', 'users')).toBe(false)
  })
})

describe('usePostgresTree', () => {
  it('loads a schema\'s tables the first time it opens, and not again', async () => {
    listTables.mockResolvedValue([{ name: 'users', kind: 'table' }])
    const t = usePostgresTree('c1')

    await t.toggleSchema('public')
    expect(listTables).toHaveBeenCalledWith({ connectionId: 'c1', schema: 'public' })
    expect(t.tables.value.public).toEqual([{ name: 'users', kind: 'table' }])
    expect(t.openSchemas.value.public).toBe(true)

    await t.toggleSchema('public')
    await t.toggleSchema('public')
    expect(listTables).toHaveBeenCalledTimes(1)
  })

  it('closes the schema and keeps the error when its tables fail to load', async () => {
    listTables.mockRejectedValue({ code: 'postgres', message: 'permission denied for schema app' })
    const t = usePostgresTree('c1')

    await t.toggleSchema('app')

    expect(t.openSchemas.value.app).toBe(false)
    expect(t.errors.value.app).toBe('permission denied for schema app')
    expect(t.loading.value.app).toBe(false)
  })

  it('reloads the open schemas\' tables on refresh, and forgets the closed ones', async () => {
    listTables.mockResolvedValue([{ name: 'users', kind: 'table' }])
    const t = usePostgresTree('c1')
    await t.toggleSchema('public')
    await t.toggleSchema('audit')
    await t.toggleSchema('audit')
    listTables.mockClear()
    listTables.mockResolvedValue([{ name: 'users', kind: 'table' }, { name: 'orders', kind: 'table' }])

    await t.reloadTables()
    expect(listTables).toHaveBeenCalledTimes(1)
    expect(listTables).toHaveBeenCalledWith({ connectionId: 'c1', schema: 'public' })
    expect(t.tables.value.public).toHaveLength(2)
    expect(t.tables.value.audit).toBeUndefined()
    expect(t.openSchemas.value.public).toBe(true)
  })

  it('toggles showing the system schemas, hidden at first', () => {
    const t = usePostgresTree('c1')
    expect(t.showSystem.value).toBe(false)
    t.toggleSystem()
    expect(t.showSystem.value).toBe(true)
  })

  it('loads a table\'s columns the first time it opens, marking keys and where they point', async () => {
    listColumns.mockResolvedValue([
      { name: 'id', dataType: 'integer', isPrimaryKey: true, nullable: false },
      { name: 'region_id', dataType: 'integer', isPrimaryKey: false, nullable: true },
    ])
    listForeignKeys.mockResolvedValue([
      { fromSchema: 'public', fromTable: 'merchants', fromColumn: 'region_id', toSchema: 'public', toTable: 'regions', toColumn: 'id' },
      { fromSchema: 'billing', fromTable: 'payments', fromColumn: 'merchant_id', toSchema: 'public', toTable: 'merchants', toColumn: 'id' },
    ])
    const t = usePostgresTree('c1')
    await t.toggleTable('public', 'merchants')
    expect(listColumns).toHaveBeenCalledWith({ connectionId: 'c1', schema: 'public', table: 'merchants' })
    expect(t.isTableOpen('public', 'merchants')).toBe(true)
    expect(t.columnsOf('public', 'merchants')).toEqual([
      { name: 'id', dataType: 'integer', primaryKey: true, references: null, nullable: false },
      { name: 'region_id', dataType: 'integer', primaryKey: false, references: 'regions.id', nullable: true },
    ])
    await t.toggleTable('public', 'merchants')
    await t.toggleTable('public', 'merchants')
    expect(listColumns).toHaveBeenCalledTimes(1)
  })

  it('toggles the database row', () => {
    const t = usePostgresTree('c1')
    expect(t.databaseOpen.value).toBe(false)
    t.toggleDatabase()
    expect(t.databaseOpen.value).toBe(true)
  })
})
