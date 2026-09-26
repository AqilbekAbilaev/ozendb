import { describe, it, expect } from 'vitest'
import { buildPostgresFields } from './fields.js'

describe('buildPostgresFields', () => {
  it('sends the database and credentials, and none of MongoDB\'s settings', () => {
    expect(buildPostgresFields({ database: ' app ', username: 'me', password: 'pw' })).toEqual({
      database: 'app',
      connectionType: 'standalone',
      replicaSetName: null,
      options: {},
      username: 'me',
      password: 'pw',
      authDb: null,
      authMechanism: null,
      tlsCertKeyFile: null,
    })
  })

  it('turns a blank database and credentials into null', () => {
    const fields = buildPostgresFields({ database: '  ', username: '', password: '' })
    expect([fields.database, fields.username, fields.password]).toEqual([null, null, null])
  })
})
