import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { dialect, api } from './sql.js'
import { operatorsFor } from '../sql/workspaces/builderRows.js'

const { quoteName, quoteText, like, filterText, readFilterText, sameColumn, cellKind, jsonShape, takesValue, fillsItself } = dialect

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue([])
})

describe('quoting', () => {
  it('backtick-quotes a name, doubling any backtick inside it', () => {
    expect(quoteName('Order Lines')).toBe('`Order Lines`')
    expect(quoteName('say `hi` "there"')).toBe('`say ``hi`` "there"`')
  })

  it('single-quotes a value, doubling quotes and the backslashes MySQL reads as escapes', () => {
    expect(quoteText("it's")).toBe("'it''s'")
    expect(quoteText('back\\slash')).toBe("'back\\\\slash'")
    expect(quoteText("\\'")).toBe("'\\\\'''")
  })
})

describe('like', () => {
  it('matches a column read as text under a case-insensitive collation', () => {
    expect(like('`Straße`', '%ö\\%%')).toBe("CONVERT(`Straße` USING utf8mb4) COLLATE utf8mb4_general_ci LIKE '%ö\\\\%%'")
  })
})

describe('readFilterText', () => {
  it('marks a TIMESTAMP\'s whole date and time as the UTC SQL mode wrote it in', () => {
    expect(readFilterText('2024-01-01 00:00:00', 'timestamp')).toBe('2024-01-01 00:00:00+00:00')
    expect(readFilterText('2024-01-01 00:00:00.120, 2024-06', 'timestamp(3)')).toBe('2024-01-01 00:00:00.120+00:00, 2024-06')
  })

  it('reads back to the filter SQL mode wrote', () => {
    const typed = '2024-07-01 03:59:59.5+05:00'
    const written = filterText(typed, 'timestamp(1)')
    expect(filterText(readFilterText(written, 'timestamp(1)'), 'timestamp(1)')).toBe(written)
  })

  it('leaves any other value as it is', () => {
    expect(readFilterText('2024-01-01 00:00:00', 'datetime')).toBe('2024-01-01 00:00:00')
    expect(readFilterText('59:59', 'timestamp')).toBe('59:59')
    expect(readFilterText('2024-01-01 00:00:00+05:00', 'timestamp')).toBe('2024-01-01 00:00:00+05:00')
  })
})

describe('sameColumn', () => {
  it('matches a column\'s name in any case, as MySQL does', () => {
    expect(sameColumn('Straße Ü', 'STRAßE ü')).toBe(true)
    expect(sameColumn('status', 'state')).toBe(false)
  })
})

describe('cellKind', () => {
  it('groups the types COLUMN_TYPE reports by how their cells are styled', () => {
    expect(cellKind('bigint unsigned')).toBe('num')
    expect(cellKind('decimal(10,2)')).toBe('num')
    expect(cellKind('double')).toBe('num')
    expect(cellKind('year')).toBe('num')
    expect(cellKind('varchar(255)')).toBe('str')
    expect(cellKind('longtext')).toBe('str')
    expect(cellKind("set('a','b')")).toBe('str')
    expect(cellKind('datetime(6)')).toBe('date')
    expect(cellKind('timestamp')).toBe('date')
    expect(cellKind('time')).toBe('date')
  })

  it('treats a column as an enum only when it lists its labels', () => {
    expect(cellKind("enum('new','paid')", ['new', 'paid'])).toBe('enum')
    expect(cellKind("enum('new','paid')", [])).toBe(null)
    expect(cellKind("enum('new','paid')", undefined)).toBe(null)
  })

  it('treats TINYINT(1), MySQL\'s BOOLEAN, as the small integer it can hold, so it keeps number operators', () => {
    expect(cellKind('tinyint(1)')).toBe('num')
    expect(cellKind('tinyint(1) unsigned')).toBe('num')
    expect(operatorsFor(cellKind('tinyint(1)')).map(({ op }) => op)).toEqual(expect.arrayContaining(['gt', 'ne', 'in']))
  })

  it('treats a BIT column as the number it reads as', () => {
    expect(cellKind('bit(1)')).toBe('num')
    expect(cellKind('bit(64)')).toBe('num')
  })

  it('leaves JSON, binary, spatial and unknown columns unstyled', () => {
    expect(cellKind('json')).toBe(null)
    expect(cellKind('varbinary(16)')).toBe(null)
    expect(cellKind('longblob')).toBe(null)
    expect(cellKind('point')).toBe(null)
    expect(cellKind(undefined)).toBe(null)
  })
})

describe('jsonShape', () => {
  it('edits a JSON column as JSON and every other one as plain text', () => {
    expect(jsonShape('json')).toBe('json')
    expect(jsonShape('varchar(20)')).toBe(null)
    expect(jsonShape(undefined)).toBe(null)
  })
})

describe('takesValue', () => {
  it('refuses a generated column, virtual or stored', () => {
    expect(takesValue({ name: 'area ü', dataType: 'int', generated: true })).toBe(false)
  })

  it('takes a value for an auto-increment column, which the server fills when left blank', () => {
    expect(takesValue({ name: 'id', dataType: 'bigint unsigned', generated: false })).toBe(true)
    expect(takesValue(undefined)).toBe(true)
  })
})

describe('fillsItself', () => {
  it('reports an auto-increment column, which numbers a row left without a value', () => {
    expect(fillsItself({ name: 'id ü', dataType: 'bigint unsigned', autoIncrement: true })).toBe(true)
  })

  it('leaves out every other column, generated ones included', () => {
    expect(fillsItself({ name: 'note', dataType: 'text', autoIncrement: false })).toBe(false)
    expect(fillsItself({ name: 'area', dataType: 'int', generated: true, autoIncrement: false })).toBe(false)
    expect(fillsItself(undefined)).toBe(false)
  })
})

describe('api', () => {
  const target = { connectionId: 'c1', database: 'shop.eu', schema: 'shop.eu', table: 'order items' }

  it('reads the table tab\'s schema as the table\'s database', async () => {
    await api.listColumns({ connectionId: 'c1', schema: 'shop.eu', table: 'order items' })
    expect(invoke).toHaveBeenCalledWith('list_mysql_columns', { id: 'c1', database: 'shop.eu', table: 'order items' })
    await api.countTable(target, [], [])
    expect(invoke).toHaveBeenCalledWith('count_mysql_table', { id: 'c1', database: 'shop.eu', table: 'order items', joins: [], filters: [] })
  })

  it('offers foreign keys by the databases they link, as the table tab\'s schemas', async () => {
    invoke.mockResolvedValue([{ fromDatabase: 'shop.eu', fromTable: 'order items', fromColumns: ['at slot', 'at zone'], toDatabase: 'склад', toTable: 'bins', toColumns: ['slot', 'zone'] }])
    expect(await api.listForeignKeys({ connectionId: 'c1', schema: 'shop.eu', table: 'order items' })).toEqual([
      { fromSchema: 'shop.eu', fromTable: 'order items', fromColumns: ['at slot', 'at zone'], toSchema: 'склад', toTable: 'bins', toColumns: ['slot', 'zone'] },
    ])
    expect(invoke).toHaveBeenCalledWith('list_mysql_foreign_keys', { id: 'c1', database: 'shop.eu', table: 'order items' })
  })

  it('says what is not available yet rather than calling a command that does not exist', async () => {
    await expect(api.explainQuery('c1', 'SELECT 1')).rejects.toEqual({ code: 'not_available', message: "Explain isn't available for MySQL yet." })
    await expect(api.pushHistory('c1', 'SELECT 1')).rejects.toMatchObject({ message: "Query history isn't available for MySQL yet." })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('runs SQL through MySQL\'s own command', async () => {
    invoke.mockResolvedValue([{ columns: ['VERSION()'], rows: [['8.4.13']], truncated: false, elapsedMs: 1, rowsAffected: null }])
    const { rows } = await api.runQuery('c1', dialect.serverSql)
    expect(rows).toEqual([['8.4.13']])
    expect(invoke).toHaveBeenCalledWith('run_mysql_query', expect.objectContaining({ id: 'c1', sql: dialect.serverSql }))
  })

  it('saves a table\'s changes in one command, by the table\'s database', async () => {
    const changes = { inserts: [[{ column: 'note', value: 'ü' }]], updates: [], deletes: [] }
    await api.saveRows(target, changes)
    expect(invoke).toHaveBeenCalledWith('save_mysql_rows', { id: 'c1', database: 'shop.eu', table: 'order items', changes })
  })
})
