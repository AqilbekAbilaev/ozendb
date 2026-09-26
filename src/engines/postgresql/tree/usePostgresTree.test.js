import { describe, it, expect, vi, beforeEach } from 'vitest'

const listTables = vi.fn()
vi.mock('../api/resources', () => ({ listTables }))

const { usePostgresTree, visibleSchemas } = await import('./usePostgresTree.js')

beforeEach(() => vi.resetAllMocks())

describe('visibleSchemas', () => {
  it('hides PostgreSQL\'s own schemas', () => {
    const schemas = [{ name: 'pg_catalog', system: true }, { name: 'public', system: false }]
    expect(visibleSchemas(schemas)).toEqual([{ name: 'public', system: false }])
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

  it('toggles the database row', () => {
    const t = usePostgresTree('c1')
    expect(t.databaseOpen.value).toBe(false)
    t.toggleDatabase()
    expect(t.databaseOpen.value).toBe(true)
  })
})
