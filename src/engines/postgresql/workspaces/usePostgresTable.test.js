import { describe, it, expect, vi, beforeEach } from 'vitest'

const browseTable = vi.fn()
const countTable = vi.fn()
const updateRow = vi.fn()
const listColumns = vi.fn()
vi.mock('../api/queries', () => ({ browseTable, countTable, updateRow }))
vi.mock('../api/resources', () => ({ listColumns }))

const { usePostgresTable } = await import('./usePostgresTable.js')

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
  countTable.mockResolvedValue(250)
  browseTable.mockResolvedValue({
    columns: ['id', 'name', 'tags', 'meta'],
    rows: [[1, 'Ada', ['a'], { x: 1 }], [2, 'Linus', [], null]],
    truncated: false,
    elapsedMs: 3,
  })
})

async function loaded(options) {
  const t = usePostgresTable(target, options)
  await t.load()
  return t
}

describe('loading', () => {
  it('fetches the first page, the row count and the columns', async () => {
    const t = await loaded({ pageSize: 100 })
    expect(browseTable).toHaveBeenCalledWith(target, { filters: [], orderBy: null, descending: false, limit: 100, offset: 0 })
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
    expect(browseTable).toHaveBeenLastCalledWith(target, { filters: [], orderBy: 'name', descending: false, limit: 100, offset: 0 })
    await t.sortBy('name')
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ orderBy: 'name', descending: true }))
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
    const filters = [{ column: 'id', op: 'gt', value: '1' }, { column: 'name', op: 'contains', value: 'ad' }]
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ filters, offset: 0 }))
    expect(countTable).toHaveBeenLastCalledWith(target, filters)
    expect(t.activeFilters.value).toBe(2)
  })

  it('keeps applying the same filters while paging and sorting', async () => {
    const t = await loaded()
    t.setFilterText('id', '1')
    await t.applyFilters()
    await t.sortBy('name')
    expect(browseTable).toHaveBeenLastCalledWith(target, expect.objectContaining({ filters: [{ column: 'id', op: 'eq', value: '1' }] }))
  })

  it('clears every box and reloads the whole table', async () => {
    const t = await loaded()
    t.setFilterText('name', 'ad')
    await t.applyFilters()
    await t.clearFilters()
    expect(t.filterText.value).toEqual({})
    expect(t.activeFilters.value).toBe(0)
    expect(countTable).toHaveBeenLastCalledWith(target, [])
  })
})

describe('editing', () => {
  it('only edits tables with a primary key, and never array columns', async () => {
    const t = await loaded()
    expect(['id', 'name', 'tags', 'meta'].map(t.canEdit)).toEqual([true, true, false, true])

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
