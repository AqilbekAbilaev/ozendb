import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { browseTable, countTable, readTableSelect, runQuery, cancelQuery, beginTransaction, commitTransaction, rollbackTransaction, formatQuery } from './queries'

const target = { connectionId: 'c1', database: 'shop `2024` ü', table: 'order items' }

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue(null)
})

describe('MySQL queries', () => {
  const joins = [{ schema: 'other db', table: 'склад', kind: 'left', on: [{ column: 'slot', equals: { table: 0, column: 'at slot' } }] }]

  it('browses a page of a table and its joins, sorted by a joined column', async () => {
    const filters = [{ table: 1, column: 'qty', op: 'gt', value: '5' }]
    await browseTable(target, { joins, filters, orderBy: { table: 1, column: 'qty' }, descending: true, limit: 50, offset: 100 })
    expect(invoke).toHaveBeenCalledWith('browse_mysql_table', {
      id: 'c1', database: 'shop `2024` ü', table: 'order items', joins, filters, orderBy: 'qty', orderTable: 1, descending: true, limit: 50, offset: 100,
    })
  })

  it('browses by the primary key when no column is chosen', async () => {
    await browseTable(target, { orderBy: null, limit: 100, offset: 0 })
    expect(invoke).toHaveBeenCalledWith('browse_mysql_table', expect.objectContaining({ joins: [], filters: [], orderBy: null, orderTable: 0, descending: false }))
  })

  it('counts the rows the filters keep, joins included', async () => {
    await countTable(target, [{ table: 0, column: 'qty', op: 'isNull' }], joins)
    expect(invoke).toHaveBeenCalledWith('count_mysql_table', {
      id: 'c1', database: 'shop `2024` ü', table: 'order items', joins, filters: [{ table: 0, column: 'qty', op: 'isNull' }],
    })
  })

  it('reads a table tab\'s SQL back by the table\'s database', async () => {
    await readTableSelect(target, 'SELECT * FROM `order items`')
    expect(invoke).toHaveBeenCalledWith('read_mysql_table_select', { sql: 'SELECT * FROM `order items`', database: 'shop `2024` ü', table: 'order items' })
  })
})

describe('running MySQL SQL', () => {
  it('runs a script in the run\'s transaction and database, answering with its last result', async () => {
    const statements = [
      { columns: [], rows: [], truncated: false, elapsedMs: 1, rowsAffected: 2 },
      { columns: ['ü'], rows: [['a']], truncated: false, elapsedMs: 3, rowsAffected: null },
    ]
    invoke.mockResolvedValue(statements)
    expect(await runQuery('c1', 'UPDATE t SET a = 1; SELECT 1', 'run 1', 'tx 1', 'shop `2024` ü')).toEqual({ ...statements[1], statements })
    expect(invoke).toHaveBeenCalledWith('run_mysql_query', { id: 'c1', sql: 'UPDATE t SET a = 1; SELECT 1', runId: 'run 1', txId: 'tx 1', database: 'shop `2024` ü' })
  })

  it('cancels a run by its id', async () => {
    await cancelQuery('c1', 'run 1')
    expect(invoke).toHaveBeenCalledWith('cancel_mysql_query', { id: 'c1', runId: 'run 1' })
  })

  it('begins, commits and rolls back a held transaction', async () => {
    await beginTransaction('c1', 'tx 1', 'shop `2024` ü')
    expect(invoke).toHaveBeenCalledWith('begin_mysql_transaction', { id: 'c1', txId: 'tx 1', database: 'shop `2024` ü' })
    await commitTransaction('tx 1')
    expect(invoke).toHaveBeenCalledWith('commit_mysql_transaction', { txId: 'tx 1' })
    await rollbackTransaction('tx 2')
    expect(invoke).toHaveBeenCalledWith('rollback_mysql_transaction', { txId: 'tx 2' })
  })

  it('formats SQL', async () => {
    await formatQuery('select 1')
    expect(invoke).toHaveBeenCalledWith('format_mysql_sql', { sql: 'select 1' })
  })
})
