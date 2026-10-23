import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive } from 'vue'

const browseTable = vi.fn()
const countTable = vi.fn()
const listColumns = vi.fn()
const saveRows = vi.fn()
const runQuery = vi.fn()
const readTableSelect = vi.fn()
const listForeignKeys = vi.fn()
vi.mock('../api/queries', () => ({ browseTable, countTable, saveRows, runQuery, readTableSelect, cancelQuery: vi.fn(), formatQuery: vi.fn(), beginTransaction: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn() }))
vi.mock('../api/resources', async (original) => ({ ...(await original()), listColumns, listForeignKeys }))

const { mysqlDefinitions } = await import('./mysqlDefinitions.js')
const { createTableRuntime } = await import('../../sql/workspaces/tableState.js')
const { createSqlRun } = await import('../../sql/workspaces/runSql.js')
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
  listForeignKeys.mockResolvedValue([])
  runQuery.mockResolvedValue({ columns: ['VERSION()', '@@character_set_server'], rows: [['8.4.13', 'utf8mb4']], truncated: false, elapsedMs: 1, rowsAffected: null })
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
    expect(runQuery).toHaveBeenCalledWith('c1', 'SELECT VERSION(), @@character_set_server')
    expect(t.server.value).toEqual({ version: '8.4.13', encoding: 'utf8mb4' })
  })

  it('writes its filters\' values in SQL mode as the backend\'s filter reads them', async () => {
    const created = opened()
    const tab = reactive({ ...created.fields, target: created.target, engine: 'mysql' })
    const t = useSqlTable(tab, { readOnly: false })
    await t.load()
    tab.state.query.filters = [{ key: 'id', op: 'gte', value: '18446744073709551615' }, { key: 'note', op: 'eq', value: '5' }]
    expect(t.currentSql.value).toBe('SELECT *\nFROM `shop ``2024`` ü`.`order items`\nWHERE `id` >= 18446744073709551615\n  AND `note` = \'5\'\nORDER BY `id` ASC\nLIMIT 100;')
  })

  it('reads names back from SQL mode as the columns they name, in any case, as MySQL does', async () => {
    const created = opened()
    const tab = reactive({ ...created.fields, target: created.target, engine: 'mysql' })
    const t = useSqlTable(tab, { readOnly: false })
    await t.load()
    await t.toSql()
    t.sql.value = 'edited'
    readTableSelect.mockResolvedValue({
      joins: [{ schema: 'shop `2024` ü', table: 'order items', kind: 'left', on: [{ column: 'ID', equals: { table: 0, column: 'Id' } }] }],
      columns: [{ table: 0, column: 'NOTE' }, { table: 1, column: 'Note' }],
      filters: [{ table: 1, column: 'NoTe', op: 'eq', value: 'paid' }],
      orderBy: [{ table: 0, column: 'NOTE' }], descending: false, limit: 100, offset: 0,
    })
    await t.toFilters()
    expect(t.filterRefusal.value).toBe(null)
    const [join] = t.joins.value
    expect(t.shownColumns.value).toEqual(['note', `${join.key}.note`])
    expect(t.filterText.value).toEqual({ [`${join.key}.note`]: '=paid' })
    expect(browseTable).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      joins: [{ schema: 'shop `2024` ü', table: 'order items', kind: 'left', on: [{ column: 'id', equals: { table: 0, column: 'id' } }] }],
      filters: [{ table: 1, column: 'note', op: 'eq', value: 'paid' }],
      orderBy: { table: 0, column: 'note' },
    }))
  })

  it('saves an edited cell by its row\'s primary key, in the table\'s database', async () => {
    const created = opened()
    const tab = reactive({ ...created.fields, target: created.target, engine: 'mysql' })
    const t = useSqlTable(tab, { readOnly: false })
    await t.load()
    expect(t.canEdit('note', 0)).toBe(true)
    t.stageEdit(0, 'note', 'b ü')
    expect(await t.saveChanges()).toBe(true)
    expect(saveRows).toHaveBeenCalledWith({ connectionId: 'c1', database: 'shop `2024` ü', table: 'order items' }, {
      inserts: [],
      updates: [{ set: [{ column: 'note', value: 'b ü' }], before: [{ column: 'note', value: 'a' }], where: [{ column: 'id', value: '18446744073709551615' }] }],
      deletes: [],
    })
  })

  it('keeps a table without a primary key, or on a read-only connection, from being edited', async () => {
    const created = opened()
    const tab = reactive({ ...created.fields, target: created.target, engine: 'mysql' })
    listColumns.mockResolvedValue(COLUMNS.map(column => ({ ...column, isPrimaryKey: false })))
    const keyless = useSqlTable(tab, { readOnly: false })
    await keyless.load()
    expect(keyless.canEdit('note', 0)).toBe(false)
    listColumns.mockResolvedValue(COLUMNS)
    const readOnly = useSqlTable(reactive({ ...opened().fields, target: created.target, engine: 'mysql' }), { readOnly: true })
    await readOnly.load()
    expect(readOnly.canEdit('note', 0)).toBe(false)
  })
})

describe('mysql.query', () => {
  const query = mysqlDefinitions.find(d => d.type === 'mysql.query')
  const created = (target) => query.create({ target: { resource: target, connectionName: 'local' } })

  it('opens in the database of the row it was opened on, its session starting there', () => {
    const tab = created(resource)
    expect(tab.title).toBe('SQL: shop `2024` ü')
    expect(tab.target.segments).toEqual([{ kind: 'database', name: 'shop `2024` ü' }])
    expect(tab.fields.runtime.run).toEqual(createSqlRun('mysql', 'c1', 'shop `2024` ü'))
  })

  it('opens on a connection in the database its session starts in by default', () => {
    const tab = created(createResourceRef('c1', []))
    expect(tab.title).toBe('SQL: local')
    expect(tab.fields.runtime.run).toEqual(createSqlRun('mysql', 'c1', null))
  })

  it('keeps its SQL when duplicated, but not its runs', () => {
    const tab = created(resource)
    const copy = query.duplicate({ target: tab.target, connectionName: 'local', state: { sql: 'SELECT `ü`' } })
    expect(copy.fields.state.sql).toBe('SELECT `ü`')
    expect(copy.fields.runtime.run).toEqual(createSqlRun('mysql', 'c1', 'shop `2024` ü'))
  })
})
