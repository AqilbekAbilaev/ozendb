import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive } from 'vue'

const browseTable = vi.fn()
const countTable = vi.fn()
const updateRow = vi.fn()
const listColumns = vi.fn()
const listForeignKeys = vi.fn()
const runQuery = vi.fn()
const readTableSelect = vi.fn()
const explainQuery = vi.fn()
vi.mock('../api/queries', () => ({ browseTable, countTable, updateRow, runQuery, readTableSelect, explainQuery }))
vi.mock('../api/resources', () => ({ listColumns, listForeignKeys }))
vi.mock('../api/library', () => ({ pushHistory: vi.fn(() => Promise.resolve()) }))

const { usePostgresTable } = await import('./usePostgresTable.js')
const { createTableState, createTableUi, createTableRuntime } = await import('./tableState.js')

const target = { connectionId: 'c1', schema: 'public', table: 'users' }
const COLUMNS = [
  { name: 'id', dataType: 'integer', isPrimaryKey: true },
  { name: 'name', dataType: 'text', isPrimaryKey: false },
  { name: 'tags', dataType: 'text[]', isPrimaryKey: false },
  { name: 'meta', dataType: 'jsonb', isPrimaryKey: false },
]

beforeEach(() => {
  vi.resetAllMocks()
  listColumns.mockResolvedValue(COLUMNS)
  listForeignKeys.mockResolvedValue([])
  runQuery.mockResolvedValue({ columns: ['version', 'encoding'], rows: [['16.2', 'UTF8']] })
  countTable.mockResolvedValue(250)
  browseTable.mockResolvedValue({
    columns: ['id', 'name', 'tags', 'meta'],
    rows: [[1, 'Ada', ['a'], { x: 1 }], [2, 'Linus', [], null]],
    truncated: false,
    elapsedMs: 3,
  })
})

// A table tab as the workspace holds it, with the state it starts from.
const tabOf = ({ pageSize, initial } = {}) =>
  reactive({ ...target, state: initial ?? createTableState({ limit: pageSize }), ui: createTableUi(), runtime: createTableRuntime(target.connectionId) })
const table = ({ readOnly, ...start } = {}) => usePostgresTable(tabOf(start), { readOnly })

async function loaded(options) {
  const t = table(options)
  await t.load()
  return t
}

describe('loading', () => {
  it('fetches the first page, the row count and the columns', async () => {
    const t = await loaded({ pageSize: 100 })
    expect(browseTable).toHaveBeenCalledWith(target, { joins: [], filters: [], orderBy: null, descending: false, limit: 100, offset: 0 })
    expect(t.columns.value).toEqual(['id', 'name', 'tags', 'meta'])
    expect(t.rows.value).toHaveLength(2)
    expect(t.total.value).toBe(250)
    expect(t.error.value).toBe(null)
  })

  it('keeps how long the page took, for the footer', async () => {
    const t = await loaded()
    expect(t.elapsedMs.value).toBe(3)
  })

  it('keeps the error and no rows when the page fails to load', async () => {
    browseTable.mockRejectedValue({ code: 'postgres', message: 'permission denied for table users' })
    const t = await loaded()
    expect(t.error.value).toBe('permission denied for table users')
    expect(t.rows.value).toEqual([])
    expect(t.loading.value).toBe(false)
  })

  it('selects nothing in a fresh page, loaded or failed: its rows are other rows', async () => {
    const t = await loaded()
    t.selection.value.selectedRow = 1
    await t.load()
    expect(t.selection.value.selectedRow).toBe(-1)
    t.selection.value.selectedRow = 1
    browseTable.mockRejectedValue({ code: 'postgres', message: 'gone' })
    await t.load()
    expect(t.selection.value.selectedRow).toBe(-1)
  })

  it('keeps the selection through a cell edit, which changes no row\'s place', async () => {
    updateRow.mockResolvedValue(1)
    const t = await loaded()
    t.selection.value.selectedRow = 1
    await t.saveCell(1, 'name', 'Linus T')
    expect(t.selection.value.selectedRow).toBe(1)
  })
})

describe('paging and sorting', () => {
  it('moves a page at a time within the row count', async () => {
    const t = await loaded({ pageSize: 100 })
    expect([t.hasPrev.value, t.hasNext.value]).toEqual([false, true])

    await t.nextPage()
    await t.nextPage()
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ offset: 200 }))
    expect(t.hasNext.value).toBe(false)

    await t.prevPage()
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ offset: 100 }))
  })

  it('sorts by a column, flips direction on a second click, and restarts from page one', async () => {
    const t = await loaded({ pageSize: 100 })
    await t.nextPage()

    await t.sortBy('name')
    expect(browseTable).toHaveBeenLastCalledWith(target, { joins: [], filters: [], orderBy: { table: 0, column: 'name' }, descending: false, limit: 100, offset: 0 })
    await t.sortBy('name')
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ orderBy: { table: 0, column: 'name' }, descending: true }))
  })
})

describe('filtering', () => {
  it('applies the typed boxes, read by column type, to the page and a fresh count', async () => {
    const t = await loaded({ pageSize: 100 })
    await t.nextPage()
    t.setFilterText('id', '>1')
    t.setFilterText('name', 'ad')
    t.setFilterText('meta', '  ')
    expect(browseTable).toHaveBeenCalledTimes(2)

    await t.applyFilters()
    const filters = [{ table: 0, column: 'id', op: 'gt', value: '1' }, { table: 0, column: 'name', op: 'contains', value: 'ad' }]
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ filters, offset: 0 }))
    expect(countTable).toHaveBeenLastCalledWith(target, filters, [])
    expect(t.activeFilters.value).toBe(2)
  })

  it('keeps applying the same filters while paging and sorting', async () => {
    const t = await loaded()
    t.setFilterText('id', '1')
    await t.applyFilters()
    await t.sortBy('name')
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ filters: [{ table: 0, column: 'id', op: 'eq', value: '1' }] }))
  })

  it('clears every box and reloads the whole table', async () => {
    const t = await loaded()
    t.setFilterText('name', 'ad')
    await t.applyFilters()
    await t.clearFilters()
    expect(t.filterText.value).toEqual({})
    expect(t.activeFilters.value).toBe(0)
    expect(countTable).toHaveBeenLastCalledWith(target, [], [])
  })
})

describe('query builder', () => {
  it('replaces every filter box at once without applying them', async () => {
    const t = await loaded()
    t.setFilterText('name', 'ad')
    t.replaceFilterText({ id: '>1' })
    expect(t.filterText.value).toEqual({ id: '>1' })
    expect(browseTable).toHaveBeenCalledTimes(1)
  })

  it('sorts by a chosen column and direction, or not at all, from page one', async () => {
    const t = await loaded()
    await t.nextPage()
    await t.setSort('name', true)
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ orderBy: { table: 0, column: 'name' }, descending: true, offset: 0 }))
    await t.setSort(null, false)
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ orderBy: null, descending: false }))
  })
})

describe('shown columns', () => {
  it('shows just the chosen columns, without reloading', async () => {
    const t = await loaded()
    t.setShownColumns(['name', 'id'])
    expect(t.view.value).toEqual({ columns: ['name', 'id'], rows: [['Ada', 1], ['Linus', 2]] })
    expect(browseTable).toHaveBeenCalledTimes(1)
    t.setShownColumns([])
    expect(t.view.value.columns).toEqual(['id', 'name', 'tags', 'meta'])
  })

  it('selects them in the SQL, and takes them from an edited query', async () => {
    const t = await loaded()
    t.setShownColumns(['name'])
    expect(t.currentSql.value).toMatch(/^SELECT "name"\n/)
    await t.toSql()
    t.sql.value = 'edited'
    readTableSelect.mockResolvedValue({ joins: [], columns: [{ table: 0, column: 'id' }], filters: [], orderBy: [], descending: false, limit: 100, offset: 0 })
    await t.toFilters()
    expect(t.shownColumns.value).toEqual(['id'])
  })

  it('still edits a cell by its hidden primary key', async () => {
    updateRow.mockResolvedValue(1)
    const t = await loaded()
    t.setShownColumns(['name'])
    await t.saveCell(0, 'name', 'Ada L.')
    expect(updateRow).toHaveBeenCalledWith(target, [{ column: 'name', value: 'Ada L.' }], [{ column: 'id', value: 1 }])
    expect(t.view.value.rows[0]).toEqual(['Ada L.'])
  })
})

describe('joins', () => {
  const REGIONS = [{ name: 'id', dataType: 'integer', isPrimaryKey: true }, { name: 'name', dataType: 'text', isPrimaryKey: false }]
  const offer = { schema: 'public', table: 'regions', on: [{ column: 'id', equals: 'id' }], label: 'regions (linked by users.region_id)' }

  async function joined() {
    const t = await loaded()
    listColumns.mockResolvedValue(REGIONS)
    await t.addJoin(offer)
    return t
  }

  it('offers the tables the browsed one links to', async () => {
    listForeignKeys.mockResolvedValue([{ fromSchema: 'public', fromTable: 'users', fromColumns: ['id'], toSchema: 'public', toTable: 'regions', toColumns: ['id'] }])
    const t = await loaded()
    await Promise.resolve()
    expect(listForeignKeys).toHaveBeenCalledWith(target)
    expect(t.joinOffers.value.map(o => o.table)).toEqual(['regions'])
  })

  it('adds a join\'s columns after the table\'s own, and reloads from page one with a fresh count', async () => {
    const t = await joined()
    expect(listColumns).toHaveBeenLastCalledWith({ connectionId: 'c1', schema: 'public', table: 'regions' })
    const joins = [{ schema: 'public', table: 'regions', kind: 'left', on: [{ column: 'id', equals: { table: 0, column: 'id' } }] }]
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ joins, offset: 0 }))
    expect(countTable).toHaveBeenLastCalledWith(target, [], joins)
    expect(t.view.value.columns).toEqual(['id', 'name', 'tags', 'meta', 'j1.id', 'j1.name'])
    expect(t.columnInfo.value['j1.name'].tableLabel).toBe('regions')
  })

  it('filters and sorts on a joined column, which it never edits', async () => {
    const t = await joined()
    t.setFilterText('j1.name', 'no')
    await t.applyFilters()
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ filters: [{ table: 1, column: 'name', op: 'contains', value: 'no' }] }))
    await t.sortBy('j1.name')
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ orderBy: { table: 1, column: 'name' } }))
    expect(t.canEdit('j1.name')).toBe(false)
    expect(t.canEdit('name')).toBe(true)
  })

  it('changes the columns a join matches on, offering only its own and earlier tables\' columns', async () => {
    const t = await joined()
    expect(t.joinChoices('j1')).toEqual({ own: ['id', 'name'], earlier: ['id', 'name', 'tags', 'meta'] })
    await t.setJoinOn('j1', 0, { column: 'name', equals: 'name' })
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({
      joins: [expect.objectContaining({ on: [{ column: 'name', equals: { table: 0, column: 'name' } }] })],
      offset: 0,
    }))
  })

  it('switches a join between keeping every row and only matches', async () => {
    const t = await joined()
    await t.setJoinKind('j1', 'inner')
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ joins: [expect.objectContaining({ kind: 'inner' })] }))
  })

  it('removing a join drops its filters, shown columns and sort', async () => {
    const t = await joined()
    t.setFilterText('j1.name', 'no')
    t.setFilterText('name', 'ad')
    await t.applyFilters()
    t.setShownColumns(['name', 'j1.name'])
    await t.sortBy('j1.name')
    await t.removeJoin('j1')
    expect(t.filterText.value).toEqual({ name: 'ad' })
    expect(t.shownColumns.value).toEqual(['name'])
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({
      joins: [], orderBy: null, filters: [{ table: 0, column: 'name', op: 'contains', value: 'ad' }],
    }))
  })

  it('writes the joins into the SQL, and reads edited joined SQL back into the builder', async () => {
    const t = await joined()
    expect(t.currentSql.value).toContain('LEFT JOIN "public"."regions" ON "regions"."id" = "users"."id"')
    await t.toSql()
    t.sql.value = 'edited'
    readTableSelect.mockResolvedValue({
      joins: [{ schema: 'public', table: 'regions', kind: 'inner', on: [{ column: 'id', equals: { table: 0, column: 'id' } }] }],
      columns: [{ table: 0, column: 'name' }, { table: 1, column: 'name' }],
      filters: [{ table: 1, column: 'name', op: 'contains', value: 'no' }],
      orderBy: [{ table: 1, column: 'name' }], descending: false, limit: 50, offset: 0,
    })
    await t.toFilters()
    expect(t.filterRefusal.value).toBe(null)
    expect(t.mode.value).toBe('filter')
    expect(listColumns).toHaveBeenLastCalledWith({ connectionId: 'c1', schema: 'public', table: 'regions' })
    expect(t.joins.value.map(j => [j.key, j.kind, j.on])).toEqual([['j2', 'inner', [{ column: 'id', equals: 'id' }]]])
    expect(t.shownColumns.value).toEqual(['name', 'j2.name'])
    expect(t.filterText.value).toEqual({ 'j2.name': 'no' })
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({
      joins: [{ schema: 'public', table: 'regions', kind: 'inner', on: [{ column: 'id', equals: { table: 0, column: 'id' } }] }],
      filters: [{ table: 1, column: 'name', op: 'contains', value: 'no' }],
      orderBy: { table: 1, column: 'name' }, limit: 50,
    }))
  })

  it('drops the joins when edited SQL no longer has them', async () => {
    const t = await joined()
    await t.toSql()
    t.sql.value = 'edited'
    readTableSelect.mockResolvedValue({ joins: [], columns: [], filters: [], orderBy: [], descending: false, limit: 100, offset: 0 })
    await t.toFilters()
    expect(t.joins.value).toEqual([])
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ joins: [] }))
  })
})

describe('explain', () => {
  it('explains the SQL the filters, sort and page amount to', async () => {
    explainQuery.mockResolvedValue([{ Plan: {} }])
    const t = await loaded()
    await t.explain()
    expect(explainQuery).toHaveBeenCalledWith('c1', t.currentSql.value)
    expect(t.explainRun.plan).toEqual([{ Plan: {} }])
  })
})

describe('snapshot and restore', () => {
  it('keeps what the user builds in the tab\'s state, which a new view of the tab starts from', async () => {
    const tab = tabOf()
    const t = usePostgresTable(tab)
    await t.load()
    t.setFilterText('name', 'ad')
    await t.applyFilters(25)
    await t.sortBy('name')
    t.setShownColumns(['name', 'id'])
    listColumns.mockResolvedValue([{ name: 'id', dataType: 'integer', isPrimaryKey: true }])
    await t.addJoin({ schema: 'public', table: 'regions', on: [{ column: 'id', equals: 'id' }] })
    const snap = JSON.parse(JSON.stringify(tab.state))
    expect(snap.query).toMatchObject({ filterText: { name: 'ad' }, limit: 25, orderBy: 'name', shownColumns: ['name', 'id'], nextJoin: 2 })
    expect(snap.query.joins).toEqual([{ key: 'j1', schema: 'public', table: 'regions', kind: 'left', on: [{ column: 'id', equals: 'id' }] }])

    browseTable.mockClear()
    listColumns.mockResolvedValue(COLUMNS)
    const again = table({ initial: snap })
    await again.load()
    expect(again.filterText.value).toEqual({ name: 'ad' })
    expect(again.limit.value).toBe(25)
    expect(again.shownColumns.value).toEqual(['name', 'id'])
    expect(again.joins.value.map(j => j.key)).toEqual(['j1'])
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({
      limit: 25, orderBy: { table: 0, column: 'name' },
      filters: [{ table: 0, column: 'name', op: 'contains', value: 'ad' }],
      joins: [expect.objectContaining({ table: 'regions' })],
    }))
  })

  it('brings SQL mode back with its SQL, and keys new joins after the restored ones', async () => {
    const initial = createTableState()
    initial.mode = 'sql'
    initial.sql = 'SELECT 1'
    initial.query.joins = [{ key: 'j3', schema: 'public', table: 'r', kind: 'left', on: [{ column: 'id', equals: 'id' }] }]
    initial.query.nextJoin = 4
    const t = table({ initial })
    await t.load()
    expect(t.mode.value).toBe('sql')
    expect(t.sql.value).toBe('SELECT 1')
    listColumns.mockResolvedValue([])
    await t.addJoin({ schema: 'public', table: 's', on: [{ column: 'id', equals: 'id' }] })
    expect(t.joins.value.map(j => j.key)).toEqual(['j3', 'j4'])
  })
})

describe('limit, messages and server details', () => {
  it('applies a new limit with the filters, restarting from the first row', async () => {
    const t = await loaded({ pageSize: 100 })
    await t.nextPage()
    await t.applyFilters(20)
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ limit: 20, offset: 0 }))
    await t.nextPage()
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ limit: 20, offset: 20 }))
  })

  it('takes an edited query\'s LIMIT as the new limit', async () => {
    const t = await loaded({ pageSize: 100 })
    await t.toSql()
    t.sql.value = 'edited'
    readTableSelect.mockResolvedValue({ joins: [], columns: [], filters: [], orderBy: [], descending: false, limit: 5, offset: 0 })
    await t.toFilters()
    expect(t.limit.value).toBe(5)
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ limit: 5 }))
  })

  it('logs each load as a message, successes with their row count and time', async () => {
    const t = await loaded()
    browseTable.mockRejectedValueOnce({ code: 'postgres', message: 'permission denied' })
    await t.refresh()
    expect(t.messages.value.map(m => [m.ok, m.text, m.ms])).toEqual([[true, 'SELECT 2', 3], [false, 'permission denied', undefined]])
  })

  it('reads the server version and encoding once, for the footer', async () => {
    runQuery.mockResolvedValue({ columns: ['version', 'encoding'], rows: [['16.2', 'UTF8']] })
    const t = await loaded()
    await t.refresh()
    await Promise.resolve()
    expect(runQuery).toHaveBeenCalledTimes(1)
    expect(t.server.value).toEqual({ version: '16.2', encoding: 'UTF8' })
  })

  it('shows the SQL the current filters, sort and page amount to', async () => {
    const t = await loaded({ pageSize: 50 })
    expect(t.currentSql.value).toBe('SELECT *\nFROM "public"."users"\nORDER BY "id" ASC\nLIMIT 50;')
  })
})

describe('SQL mode', () => {
  it('opens on the SQL for the current filters, sort and page, already run', async () => {
    const t = await loaded({ pageSize: 100 })
    t.setFilterText('id', '>1')
    await t.applyFilters()
    await t.sortBy('name')
    await t.nextPage()

    await t.toSql()
    expect(t.mode.value).toBe('sql')
    expect(t.sql.value).toBe('SELECT *\nFROM "public"."users"\nWHERE "id" > \'1\'\nORDER BY "name" ASC\nLIMIT 100 OFFSET 100;')
    expect(runQuery).toHaveBeenCalledWith('c1', t.sql.value, expect.any(String), null)
  })

  it('opens given SQL — a saved or earlier query — without running it', async () => {
    const t = await loaded()
    runQuery.mockClear()
    t.openSql('DELETE FROM users')
    expect(t.mode.value).toBe('sql')
    expect(t.sql.value).toBe('DELETE FROM users')
    expect(runQuery).not.toHaveBeenCalled()
  })

  it('orders by the primary key when nothing is sorted, as browsing does', async () => {
    const t = await loaded()
    await t.toSql()
    expect(t.sql.value).toContain('ORDER BY "id" ASC')
  })

  it('goes straight back to the filters while the SQL is the one they built', async () => {
    const t = await loaded()
    await t.toSql()
    await t.toFilters()
    expect(t.mode.value).toBe('filter')
    expect(readTableSelect).not.toHaveBeenCalled()
  })

  it('reads edited SQL back into the filter boxes, sort and page', async () => {
    const t = await loaded({ pageSize: 100 })
    await t.toSql()
    t.sql.value = 'edited'
    readTableSelect.mockResolvedValue({
      filters: [{ column: 'name', op: 'contains', value: 'ad' }, { column: 'id', op: 'gte', value: '2' }],
      joins: [], columns: [], orderBy: [{ table: 0, column: 'name' }], descending: true, limit: 100, offset: 100,
    })

    await t.toFilters()
    expect(readTableSelect).toHaveBeenCalledWith(target, 'edited')
    expect(t.mode.value).toBe('filter')
    expect(t.filterText.value).toEqual({ name: 'ad', id: '>=2' })
    const filters = [{ table: 0, column: 'name', op: 'contains', value: 'ad' }, { table: 0, column: 'id', op: 'gte', value: '2' }]
    expect(browseTable).toHaveBeenLastCalledWith(target, { joins: [], filters, orderBy: { table: 0, column: 'name' }, descending: true, limit: 100, offset: 100 })
    expect(countTable).toHaveBeenLastCalledWith(target, filters, [])
  })

  it('stays in SQL with the reason when the grid could not show that SQL', async () => {
    const t = await loaded({ pageSize: 100 })
    await t.toSql()
    t.sql.value = 'edited'
    const read = { joins: [], columns: [], filters: [], orderBy: [], descending: false, limit: 100, offset: 0 }

    readTableSelect.mockRejectedValue({ code: 'sql', message: 'only SELECT * can be shown as filters' })
    await t.toFilters()
    expect(t.filterRefusal.value).toBe('only SELECT * can be shown as filters')

    readTableSelect.mockResolvedValue({ ...read, limit: null })
    await t.toFilters()
    expect(t.filterRefusal.value).toMatch(/LIMIT/)

    readTableSelect.mockResolvedValue({ ...read, filters: [{ column: 'id', op: 'contains', value: '4' }] })
    await t.toFilters()
    expect(t.filterRefusal.value).toMatch(/"id"/)

    readTableSelect.mockResolvedValue({ ...read, orderBy: [{ table: 0, column: 'name' }, { table: 0, column: 'meta' }] })
    await t.toFilters()
    expect(t.filterRefusal.value).toMatch(/one column/)

    expect(t.mode.value).toBe('sql')
    await t.toSql()
    expect(t.filterRefusal.value).toBe(null)
  })

  it('treats ORDER BY the primary key as no sort, as browsing does', async () => {
    const t = await loaded()
    await t.toSql()
    t.sql.value = 'edited'
    readTableSelect.mockResolvedValue({ joins: [], columns: [], filters: [], orderBy: [{ table: 0, column: 'id' }], descending: false, limit: 100, offset: 0 })
    await t.toFilters()
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ orderBy: null }))
  })
})

describe('editing', () => {
  it('only edits tables with a primary key', async () => {
    const t = await loaded()
    expect(['id', 'name', 'tags', 'meta'].map(t.canEdit)).toEqual([true, true, true, true])

    listColumns.mockResolvedValue(COLUMNS.map(c => ({ ...c, isPrimaryKey: false })))
    const keyless = await loaded()
    expect(keyless.canEdit('name')).toBe(false)
  })

  it('updates one cell by the row\'s primary key and shows the new value', async () => {
    updateRow.mockResolvedValue(1)
    const t = await loaded()

    expect(await t.saveCell(1, 'name', 'Torvalds')).toBe(true)
    expect(updateRow).toHaveBeenCalledWith(target, [{ column: 'name', value: 'Torvalds' }], [{ column: 'id', value: 2 }])
    expect(t.rows.value[1][1]).toBe('Torvalds')
  })

  it('parses a JSON column\'s text before saving it', async () => {
    updateRow.mockResolvedValue(1)
    const t = await loaded()

    await t.saveCell(0, 'meta', '{"y": 2}')
    expect(updateRow).toHaveBeenCalledWith(target, [{ column: 'meta', value: { y: 2 } }], [{ column: 'id', value: 1 }])

    expect(await t.saveCell(0, 'meta', '{broken')).toBe(false)
    expect(t.editError.value).toMatch(/JSON/)
  })

  it('edits an array column as the JSON list the grid shows', async () => {
    updateRow.mockResolvedValue(1)
    const t = await loaded()
    expect(t.editText('tags', ['a', 'b c'])).toBe('["a","b c"]')

    expect(await t.saveCell(0, 'tags', '["x", null]')).toBe(true)
    expect(updateRow).toHaveBeenCalledWith(target, [{ column: 'tags', value: ['x', null] }], [{ column: 'id', value: 1 }])

    expect(await t.saveCell(0, 'tags', '{"a": 1}')).toBe(false)
    expect(t.editError.value).toMatch(/list/)
    expect(await t.saveCell(0, 'tags', 'x')).toBe(false)
  })

  it('sets a cell to NULL when asked for NULL rather than for text', async () => {
    updateRow.mockResolvedValue(1)
    const t = await loaded()
    for (const [column, at] of [['name', 1], ['tags', 2], ['meta', 3]]) {
      expect(await t.saveCell(0, column, null), column).toBe(true)
      expect(updateRow).toHaveBeenLastCalledWith(target, [{ column, value: null }], [{ column: 'id', value: 1 }])
      expect(t.rows.value[0][at], column).toBe(null)
    }
  })

  it('reports a row that changed or vanished since it was loaded', async () => {
    updateRow.mockResolvedValue(0)
    const t = await loaded()

    expect(await t.saveCell(0, 'name', 'x')).toBe(false)
    expect(t.editError.value).toMatch(/changed or was deleted/)
    expect(t.rows.value[0][1]).toBe('Ada')
  })
})

describe('review fixes', () => {
  it('ignores a page that arrives after a newer request (sort while paging)', async () => {
    const t = await loaded({ pageSize: 100 })
    let finishOld
    browseTable.mockImplementationOnce(() => new Promise(r => { finishOld = r }))
    const old = t.nextPage()
    browseTable.mockResolvedValueOnce({ columns: ['id'], rows: [[99]], truncated: false, elapsedMs: 1 })
    await t.sortBy('id')

    finishOld({ columns: ['id'], rows: [[201]], truncated: false, elapsedMs: 1 })
    await old
    expect(t.rows.value).toEqual([[99]])
    expect(t.offset.value).toBe(0)
    expect(t.loading.value).toBe(false)
  })

  it('recounts the rows on refresh, but not when paging', async () => {
    const t = await loaded()
    await t.nextPage()
    expect(countTable).toHaveBeenCalledTimes(1)
    countTable.mockResolvedValue(3)
    await t.refresh()
    expect(countTable).toHaveBeenCalledTimes(2)
    expect(t.total.value).toBe(3)
  })

  it('seeds a JSON cell\'s editor with JSON text, so saving it unchanged round-trips', async () => {
    const t = await loaded()
    expect(t.editText('meta', 'hello')).toBe('"hello"')
    expect(t.editText('meta', { x: 1 })).toBe('{"x":1}')
    expect(t.editText('name', 'Ada')).toBe('Ada')
    expect(t.editText('name', null)).toBe('')
  })

  it('edits nothing on a read-only connection', async () => {
    const t = await loaded({ readOnly: true })
    expect(t.canEdit('name')).toBe(false)
  })
})

describe('a table that is gone or unreadable', () => {
  it('says so, rather than showing only the server\'s line', async () => {
    browseTable.mockRejectedValue({ code: 'missing', message: 'relation "public.users" does not exist' })
    const t = table()
    await t.load()
    expect(t.error.value).toMatch(/^This table can't be found/)
  })
})

describe('panel state', () => {
  it('keeps the builder and result sub-tab in the tab\'s ui, starting closed on Result', () => {
    const tab = tabOf()
    const t = usePostgresTable(tab)
    expect(t.panel).toEqual({ builderOpen: false, builderWidth: 360, rtab: 'Result' })
    t.panel.builderOpen = true
    expect(tab.ui.builderOpen).toBe(true)
  })

  it('writes the SQL and the mode into the tab\'s state', async () => {
    const tab = tabOf()
    const t = usePostgresTable(tab)
    await t.load()
    t.openSql('SELECT 2')
    expect(tab.state).toMatchObject({ mode: 'sql', sql: 'SELECT 2' })
  })
})
