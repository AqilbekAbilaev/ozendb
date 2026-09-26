import { describe, it, expect } from 'vitest'
import { buildMongoFields } from './fields.js'

const values = (over = {}) => ({
  connType: 'replica',
  replicaSetName: 'rs0',
  options: { retryWrites: 'true' },
  authMode: 'SCRAM-SHA-256',
  username: 'admin',
  password: 'secret',
  authDb: 'admin',
  useTls: true,
  tlsCertKeyFile: '/client.pem',
  ...over,
})

describe('buildMongoFields', () => {
  it('sends the topology, options, credentials and client certificate', () => {
    expect(buildMongoFields(values())).toEqual({
      database: null,
      connectionType: 'replica',
      replicaSetName: 'rs0',
      options: { retryWrites: 'true' },
      username: 'admin',
      password: 'secret',
      authDb: 'admin',
      authMechanism: 'SCRAM-SHA-256',
      tlsCertKeyFile: '/client.pem',
    })
  })

  it('sends no credentials at all when auth is none', () => {
    // The fields stay populated behind the hidden tab, so they are dropped here.
    const fields = buildMongoFields(values({ authMode: 'none' }))
    expect([fields.username, fields.password, fields.authDb]).toEqual([null, null, null])
    expect(fields.authMechanism).toBe('none')
  })

  it('turns blanks into null and drops the client certificate when TLS is off', () => {
    const fields = buildMongoFields(values({ replicaSetName: '', username: '', useTls: false }))
    expect(fields.replicaSetName).toBe(null)
    expect(fields.username).toBe(null)
    expect(fields.tlsCertKeyFile).toBe(null)
  })
})
