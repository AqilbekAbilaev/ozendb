import { describe, it, expect } from 'vitest'
import { buildSqlFields } from './fields.js'

describe('buildSqlFields', () => {
  it('sends only the database and credentials', () => {
    expect(buildSqlFields({ database: ' sales 2024 ', username: 'app user', password: 'pw' })).toEqual({
      database: 'sales 2024',
      username: 'app user',
      password: 'pw',
    })
  })

  it('turns a blank database and credentials into null', () => {
    const fields = buildSqlFields({ database: '  ', username: '', password: '' })
    expect([fields.database, fields.username, fields.password]).toEqual([null, null, null])
  })
})
