import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { runQuery, cancelQuery, explainQuery, formatQuery, beginTransaction, commitTransaction, rollbackTransaction, browseTable, countTable, updateRow, deleteRows, insertRow, readTableSelect } from './queries'

const table = { connectionId: 'c1', schema: 'public', table: 'users' }

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue(null)
})

describe('PostgreSQL queries', () => {
  it('runs SQL against a connection', async () => {
    await runQuery('c1', 'SELECT 1')
    expect(invoke).toHaveBeenCalledWith('run_pg_query', { id: 'c1', sql: 'SELECT 1', runId: null, txId: null, database: null })
  })

  it('names a run so it can be cancelled, and cancels it by that name', async () => {
    await runQuery('c1', 'SELECT pg_sleep(9)', 'run-1')
    expect(invoke).toHaveBeenCalledWith('run_pg_query', { id: 'c1', sql: 'SELECT pg_sleep(9)', runId: 'run-1', txId: null, database: null })
    await cancelQuery('c1', 'run-1')
    expect(invoke).toHaveBeenCalledWith('cancel_pg_query', { id: 'c1', runId: 'run-1' })
  })

  it('holds a transaction open, runs in it, and ends it', async () => {
    await beginTransaction('c1', 'tx-1')
    expect(invoke).toHaveBeenCalledWith('begin_pg_transaction', { id: 'c1', txId: 'tx-1', database: null })
    await runQuery('c1', 'DELETE FROM t', 'run-1', 'tx-1')
    expect(invoke).toHaveBeenCalledWith('run_pg_query', { id: 'c1', sql: 'DELETE FROM t', runId: 'run-1', txId: 'tx-1', database: null })
    await commitTransaction('tx-1')
    expect(invoke).toHaveBeenCalledWith('commit_pg_transaction', { txId: 'tx-1' })
    await rollbackTransaction('tx-1')
    expect(invoke).toHaveBeenCalledWith('rollback_pg_transaction', { txId: 'tx-1' })
  })

  it('formats SQL', async () => {
    await formatQuery('select 1')
    expect(invoke).toHaveBeenCalledWith('format_pg_sql', { sql: 'select 1' })
  })

  it('explains a query', async () => {
    await explainQuery('c1', 'SELECT 1')
    expect(invoke).toHaveBeenCalledWith('explain_pg_query', { id: 'c1', sql: 'SELECT 1', database: null })
  })

  it('targets a database other than the connection\'s own for query/transaction/explain', async () => {
    await runQuery('c1', 'SELECT 1', 'run-1', null, 'otherdb')
    expect(invoke).toHaveBeenCalledWith('run_pg_query', { id: 'c1', sql: 'SELECT 1', runId: 'run-1', txId: null, database: 'otherdb' })
    await beginTransaction('c1', 'tx-1', 'otherdb')
    expect(invoke).toHaveBeenCalledWith('begin_pg_transaction', { id: 'c1', txId: 'tx-1', database: 'otherdb' })
    await explainQuery('c1', 'SELECT 1', 'otherdb')
    expect(invoke).toHaveBeenCalledWith('explain_pg_query', { id: 'c1', sql: 'SELECT 1', database: 'otherdb' })
  })

  it('browses a page of a table, unordered by default', async () => {
    await browseTable(table, { limit: 50, offset: 100 })
    expect(invoke).toHaveBeenCalledWith('browse_pg_table', {
      id: 'c1', schema: 'public', table: 'users',
      joins: [], filters: [], orderBy: null, orderTable: 0, descending: false, limit: 50, offset: 100,
    })
  })

  it('passes a sort column and direction through', async () => {
    await browseTable(table, { orderBy: { table: 1, column: 'name' }, descending: true, limit: 50, offset: 0 })
    expect(invoke).toHaveBeenCalledWith('browse_pg_table', expect.objectContaining({ orderBy: 'name', orderTable: 1, descending: true }))
  })

  it('counts the rows of a table', async () => {
    await countTable(table)
    expect(invoke).toHaveBeenCalledWith('count_pg_table', { id: 'c1', schema: 'public', table: 'users', joins: [], filters: [] })
  })

  it('passes column filters to both the page and the count', async () => {
    const filters = [{ column: 'age', op: 'gt', value: '30' }]
    await browseTable(table, { filters, limit: 50, offset: 0 })
    await countTable(table, filters)
    expect(invoke).toHaveBeenCalledWith('browse_pg_table', expect.objectContaining({ filters }))
    expect(invoke).toHaveBeenCalledWith('count_pg_table', expect.objectContaining({ filters }))
  })

  it('reads a table tab\'s SQL back as filters for that table', async () => {
    await readTableSelect(table, 'SELECT * FROM users')
    expect(invoke).toHaveBeenCalledWith('read_pg_table_select', { sql: 'SELECT * FROM users', schema: 'public', table: 'users' })
  })

  it('updates one row, identified by its key columns', async () => {
    const set = [{ column: 'name', value: 'Ada' }]
    const where = [{ column: 'id', value: 1 }]
    await updateRow(table, set, where)
    expect(invoke).toHaveBeenCalledWith('update_pg_row', { id: 'c1', schema: 'public', table: 'users', set, where, txId: null })
  })

  it('updates one row inside a held transaction', async () => {
    const set = [{ column: 'name', value: 'Ada' }]
    const where = [{ column: 'id', value: 1 }]
    await updateRow(table, set, where, 'tx-1')
    expect(invoke).toHaveBeenCalledWith('update_pg_row', { id: 'c1', schema: 'public', table: 'users', set, where, txId: 'tx-1' })
  })

  it('deletes a batch of rows, each identified by its key columns', async () => {
    const rows = [[{ column: 'id', value: 1 }], [{ column: 'id', value: 2 }]]
    await deleteRows(table, rows)
    expect(invoke).toHaveBeenCalledWith('delete_pg_rows', { id: 'c1', schema: 'public', table: 'users', rows, txId: null })
  })

  it('inserts a row from its column/value pairs', async () => {
    const values = [{ column: 'name', value: 'Ada' }]
    await insertRow(table, values)
    expect(invoke).toHaveBeenCalledWith('insert_pg_row', { id: 'c1', schema: 'public', table: 'users', values, txId: null })
  })

  it('inserts a row inside a held transaction', async () => {
    const values = [{ column: 'name', value: 'Ada' }]
    await insertRow(table, values, 'tx-1')
    expect(invoke).toHaveBeenCalledWith('insert_pg_row', { id: 'c1', schema: 'public', table: 'users', values, txId: 'tx-1' })
  })
})
