import { describe, it, expect, vi, beforeEach } from 'vitest'

const listTables = vi.fn()
const listColumns = vi.fn()
const listStoredPrograms = vi.fn()
vi.mock('../api/resources', () => ({ listTables, listColumns, listStoredPrograms }))

const { useMySqlTree, visibleDatabases, columnRow, programFolders } = await import('./useMySqlTree.js')

const noPrograms = { routines: [], triggers: [], events: [] }

beforeEach(() => {
  vi.resetAllMocks()
  listStoredPrograms.mockResolvedValue(noPrograms)
})

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

describe('programFolders', () => {
  const tables = [{ name: 'order items', kind: 'table' }, { name: 'big `view` ü', kind: 'view' }]
  const programs = {
    routines: [
      { name: 'same name ü', kind: 'function', returns: 'varchar(10)' },
      { name: 'same name ü', kind: 'procedure', returns: null },
    ],
    triggers: [{ name: 'stamp; ü', table: 'order items', timing: 'BEFORE', event: 'INSERT' }],
    events: [{ name: 'nightly', schedule: 'EVERY 1 DAY', status: 'DISABLED' }],
  }

  it('gives views and each kind of stored program a folder of its own, in a fixed order', () => {
    expect(programFolders(tables, programs).map(folder => [folder.kind, folder.rows.map(row => row.name)])).toEqual([
      ['view', ['big `view` ü']],
      ['procedure', ['same name ü']],
      ['function', ['same name ü']],
      ['trigger', ['stamp; ü']],
      ['event', ['nightly']],
    ])
  })

  it('says what a function returns, when a trigger fires, and when an event runs', () => {
    const meta = Object.fromEntries(programFolders(tables, programs).map(folder => [folder.kind, folder.rows[0].meta]))
    expect(meta).toEqual({ view: null, procedure: null, function: '→ varchar(10)', trigger: 'BEFORE INSERT on order items', event: 'EVERY 1 DAY · disabled' })
  })

  it('leaves out what a function returns when MySQL hides it from the login', () => {
    const hidden = { ...noPrograms, routines: [{ name: 'secret ü', kind: 'function', returns: null }] }
    expect(programFolders([], hidden)[0].rows).toEqual([{ name: 'secret ü', meta: null }])
  })

  it('gives a view\'s row the view menu and every stored program\'s the program menu', () => {
    expect(programFolders(tables, programs).map(folder => folder.menu)).toEqual(['view', 'program', 'program', 'program', 'program'])
  })

  it('lets only a view\'s row open onto its columns', () => {
    expect(programFolders(tables, programs).map(folder => !!folder.hasColumns)).toEqual([true, false, false, false, false])
  })

  it('leaves out a folder with nothing in it', () => {
    expect(programFolders([{ name: 'order items', kind: 'table' }], noPrograms)).toEqual([])
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

  it('reads a database\'s stored programs with its tables, and keeps its tables apart from its views', async () => {
    listTables.mockResolvedValue([{ name: 'order items', kind: 'table', estimatedRows: 12 }, { name: 'big view', kind: 'view', estimatedRows: null }])
    listStoredPrograms.mockResolvedValue({ ...noPrograms, events: [{ name: 'nightly', schedule: 'EVERY 1 DAY', status: 'ENABLED' }] })
    const tree = useMySqlTree('c1')
    await tree.toggleDatabase(shop)
    expect(listStoredPrograms).toHaveBeenCalledWith({ connectionId: 'c1', database: shop })
    expect(tree.tablesOf(shop).map(table => table.name)).toEqual(['order items'])
    expect(tree.foldersOf(shop).map(folder => folder.kind)).toEqual(['view', 'event'])
  })

  it('opens and closes a database\'s folders one by one', async () => {
    const tree = useMySqlTree('c1')
    tree.toggleFolder(shop, 'event')
    expect(tree.isFolderOpen(shop, 'event')).toBe(true)
    expect(tree.isFolderOpen(shop, 'view')).toBe(false)
    expect(tree.isFolderOpen('crm', 'event')).toBe(false)
    tree.toggleFolder(shop, 'event')
    expect(tree.isFolderOpen(shop, 'event')).toBe(false)
  })

  it('closes a database whose tables fail to load, with the reason', async () => {
    listTables.mockRejectedValue({ code: 'forbidden', message: 'Access denied for user to database' })
    const tree = useMySqlTree('c1')
    await tree.toggleDatabase(shop)
    expect(tree.openDatabases.value[shop]).toBe(false)
    expect(tree.errors.value[shop]).toBe('Access denied for user to database')
  })

  it('keeps a database\'s tables and views open when its stored programs fail to load, with the reason', async () => {
    listTables.mockResolvedValue([{ name: 'order items', kind: 'table', estimatedRows: 12 }, { name: 'big view', kind: 'view', estimatedRows: null }])
    listStoredPrograms.mockRejectedValue({ code: 'forbidden', message: 'SELECT command denied on ROUTINES ü' })
    const tree = useMySqlTree('c1')
    await tree.toggleDatabase(shop)
    expect(tree.openDatabases.value[shop]).toBe(true)
    expect(tree.errors.value[shop]).toBeUndefined()
    expect(tree.tablesOf(shop).map(table => table.name)).toEqual(['order items'])
    expect(tree.foldersOf(shop).map(folder => folder.kind)).toEqual(['view'])
    expect(tree.programsError(shop)).toBe('SELECT command denied on ROUTINES ü')
  })

  it('forgets a stored-programs error on a refresh that reads them', async () => {
    listTables.mockResolvedValue([])
    listStoredPrograms.mockRejectedValueOnce(new Error('SELECT command denied'))
    const tree = useMySqlTree('c1')
    await tree.toggleDatabase(shop)
    await tree.reloadTables()
    expect(tree.programsError(shop)).toBeNull()
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

  it('reads a view\'s columns when its row opens, as a table\'s', async () => {
    listColumns.mockResolvedValue([{ name: 'total ü', dataType: 'decimal(10,2)', nullable: true, isPrimaryKey: false, default: null, references: null }])
    const tree = useMySqlTree('c1')
    await tree.toggleTable(shop, 'big `view` ü')
    expect(listColumns).toHaveBeenCalledWith({ connectionId: 'c1', database: shop, table: 'big `view` ü' })
    expect(tree.columnsOf(shop, 'big `view` ü').map(column => column.name)).toEqual(['total ü'])
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
