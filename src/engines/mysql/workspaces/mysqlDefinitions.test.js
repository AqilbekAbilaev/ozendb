import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive } from 'vue'

const browseTable = vi.fn()
const countTable = vi.fn()
const listColumns = vi.fn()
vi.mock('../api/queries', () => ({ browseTable, countTable }))
vi.mock('../api/resources', async (original) => ({ ...(await original()), listColumns }))

const { mysqlDefinitions } = await import('./mysqlDefinitions.js')
const { createTableRuntime } = await import('../../sql/workspaces/tableState.js')
const { useSqlTable } = await import('../../sql/workspaces/useSqlTable.js')
const { createResourceRef } = await import('../../../utils/resourceRef')

const def = mysqlDefinitions[0]
const resource = createResourceRef('c1', [{ kind: 'database', name: 'shop `2024` ü' }, { kind: 'table', name: 'order items' }])
const opened = () => def.create({ target: { resource, connectionName: 'local' } })
const COLUMNS = [
  { name: 'id', dataType: 'bigint unsigned', isPrimaryKey: true },
  { name: 'note', dataType: 'text', isPrimaryKey: false },
]

beforeEach(() => {
  vi.resetAllMocks()
  listColumns.mockResolvedValue(COLUMNS)
  countTable.mockResolvedValue(1)
  browseTable.mockResolvedValue({ columns: ['id', 'note'], rows: [['18446744073709551615', 'a']], truncated: false, elapsedMs: 2 })
})

describe('mysql.table_browse', () => {
  it('opens a tab on the table\'s ref, named by the table', () => {
    const created = opened()
    expect(def.type).toBe('mysql.table_browse')
    expect(created.title).toBe('order items')
    expect(created.target).toBe(resource)
    expect(created.fields.runtime).toEqual(createTableRuntime('mysql', 'c1'))
  })

  it('loads its page from the table\'s database and writes its SQL with backticks', async () => {
    const created = opened()
    const tab = reactive({ ...created.fields, target: created.target, engine: 'mysql' })
    const t = useSqlTable(tab, { readOnly: false })
    await t.load()
    const table = { connectionId: 'c1', database: 'shop `2024` ü', table: 'order items' }
    expect(listColumns).toHaveBeenCalledWith(table)
    expect(browseTable).toHaveBeenCalledWith(table, expect.objectContaining({ filters: [], limit: 100, offset: 0 }))
    expect(t.rows.value).toEqual([['18446744073709551615', 'a']])
    expect(t.total.value).toBe(1)
    expect(t.currentSql.value).toBe('SELECT *\nFROM `shop ``2024`` ü`.`order items`\nORDER BY `id` ASC\nLIMIT 100;')
  })
})
