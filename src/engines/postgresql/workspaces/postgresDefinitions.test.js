import { describe, it, expect } from 'vitest'
import { postgresDefinitions } from './postgresDefinitions.js'

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
