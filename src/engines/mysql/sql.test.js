import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { dialect, api } from './sql.js'

const { quoteName, quoteText, like, cellKind, jsonShape } = dialect

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

  it('treats TINYINT(1) as the number it holds', () => {
    expect(cellKind('tinyint(1)')).toBe('num')
  })

  it('leaves JSON, binary, spatial and unknown columns unstyled', () => {
    expect(cellKind('json')).toBe(null)
    expect(cellKind('varbinary(16)')).toBe(null)
    expect(cellKind('bit(1)')).toBe(null)
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

describe('api', () => {
  const target = { connectionId: 'c1', database: 'shop.eu', schema: 'shop.eu', table: 'order items' }

  it('reads the table tab\'s schema as the table\'s database', async () => {
    await api.listColumns({ connectionId: 'c1', schema: 'shop.eu', table: 'order items' })
    expect(invoke).toHaveBeenCalledWith('list_mysql_columns', { id: 'c1', database: 'shop.eu', table: 'order items' })
    await api.countTable(target, [])
    expect(invoke).toHaveBeenCalledWith('count_mysql_table', { id: 'c1', database: 'shop.eu', table: 'order items', filters: [] })
  })

  it('says what is not available yet rather than calling a command that does not exist', async () => {
    await expect(api.runQuery('c1', 'SELECT 1')).rejects.toEqual({ code: 'not_available', message: "Running SQL isn't available for MySQL yet." })
    await expect(api.beginTransaction('c1', 'tx')).rejects.toMatchObject({ message: "Running SQL isn't available for MySQL yet." })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('offers no row writes yet, so its table tabs open read-only', () => {
    expect(api.insertRow).toBeUndefined()
    expect(api.updateRow).toBeUndefined()
    expect(api.deleteRows).toBeUndefined()
  })
})
