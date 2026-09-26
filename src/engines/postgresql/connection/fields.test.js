import { describe, it, expect } from 'vitest'
import { buildPostgresFields } from './fields.js'

describe('buildPostgresFields', () => {
  it('sends only the database and credentials', () => {
    expect(buildPostgresFields({ database: ' app ', username: 'me', password: 'pw' })).toEqual({
      database: 'app',
      username: 'me',
      password: 'pw',
    })
  })

  it('turns a blank database and credentials into null', () => {
    const fields = buildPostgresFields({ database: '  ', username: '', password: '' })
    expect([fields.database, fields.username, fields.password]).toEqual([null, null, null])
  })
})
