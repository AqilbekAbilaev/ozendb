import { describe, it, expect } from 'vitest'
import { buildSqlFields } from './fields.js'

const sql = (database) => ({ database })

describe('buildSqlFields', () => {
  it('sends only the database and credentials', () => {
    expect(buildSqlFields({ username: 'app user', password: 'pw' }, sql(' sales 2024 '))).toEqual({
      database: 'sales 2024',
      username: 'app user',
      password: 'pw',
    })
  })

  it('turns a blank database and credentials into null', () => {
    const fields = buildSqlFields({ username: '', password: '' }, sql('  '))
    expect([fields.database, fields.username, fields.password]).toEqual([null, null, null])
  })
})
