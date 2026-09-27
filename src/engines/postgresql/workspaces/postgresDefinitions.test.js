import { describe, it, expect, vi, beforeEach } from 'vitest'

const rollbackTransaction = vi.fn(() => Promise.resolve())
const showToast = vi.fn()
vi.mock('../api/queries', async (original) => ({ ...(await original()), rollbackTransaction }))
vi.mock('../../../stores/toast', () => ({ showToast }))

const { postgresDefinitions } = await import('./postgresDefinitions.js')
const { tableSession } = await import('./tableSessions.js')

beforeEach(() => vi.clearAllMocks())

const byType = Object.fromEntries(postgresDefinitions.map(d => [d.type, d]))
const target = { connectionId: 'c1', connectionName: 'local', database: 'app', schema: 'public', table: 'users' }

describe('postgresql.table_browse', () => {
  const def = byType['postgresql.table_browse']

  it('names the table by database, schema and table', () => {
    const created = def.create({ target })
    expect(created.title).toBe('users')
    expect(created.target).toEqual({
      connectionId: 'c1',
      segments: [
        { kind: 'database', name: 'app' },
        { kind: 'schema', name: 'public' },
        { kind: 'table', name: 'users' },
      ],
    })
    expect(created.fields).toEqual({ kind: 'pgTable', ...target })
  })

  it('duplicates onto the same table', () => {
    const tab = { ...def.create({ target }).fields, title: 'users' }
    expect(def.duplicate(tab)).toEqual(def.create({ target }))
  })
})

describe('postgresql.query', () => {
  const def = byType['postgresql.query']
  const db = { connectionId: 'c1', connectionName: 'local', database: 'app' }

  it('opens an empty editor against the connection\'s database', () => {
    const created = def.create({ target: db })
    expect(created.title).toBe('SQL: app')
    expect(created.target).toEqual({ connectionId: 'c1', segments: [{ kind: 'database', name: 'app' }] })
    expect(created.fields).toEqual({ kind: 'pgQuery', ...db, sql: '', result: null, error: null, running: false })
  })

  it('duplicates the SQL but not the result', () => {
    const tab = { ...def.create({ target: db }).fields, sql: 'SELECT 1', result: { rows: [[1]] }, error: 'x' }
    expect(def.duplicate(tab).fields).toMatchObject({ sql: 'SELECT 1', result: null, error: null, running: false })
  })
})

describe('closing a tab with a transaction open', () => {
  it('rolls a query tab\'s transaction back and says so', async () => {
    const def = byType['postgresql.query']
    await def.dispose({ id: 'q1', txId: 'tx-1' })
    expect(rollbackTransaction).toHaveBeenCalledWith('tx-1')
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/rolled back/))

    await def.dispose({ id: 'q2', txId: null })
    expect(rollbackTransaction).toHaveBeenCalledTimes(1)
  })

  it('rolls back a table tab\'s SQL-mode transaction', async () => {
    tableSession('t1', () => ({ sqlState: { txId: 'tx-2' } }))
    await byType['postgresql.table_browse'].dispose({ id: 't1' })
    expect(rollbackTransaction).toHaveBeenCalledWith('tx-2')
  })
})
