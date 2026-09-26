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
