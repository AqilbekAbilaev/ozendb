import { describe, it, expect } from 'vitest'
import { buildMongoFields } from './fields.js'

const shared = (over = {}) => ({
  username: 'admin',
  password: 'secret',
  useTls: true,
  ...over,
})

// MongoDB's own values, as useMongoFields' values() hands them over.
const mongo = (over = {}) => ({
  connType: 'replica',
  replicaSetName: 'rs0',
  authMode: 'SCRAM-SHA-256',
  authDb: 'admin',
  tlsCertKeyFile: '/client.pem',
  options: { retryWrites: 'true' },
  ...over,
})

describe('buildMongoFields', () => {
  it('sends the topology, options, credentials and client certificate', () => {
    expect(buildMongoFields(shared(), mongo())).toEqual({
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
    const fields = buildMongoFields(shared(), mongo({ authMode: 'none' }))
    expect([fields.username, fields.password, fields.authDb]).toEqual([null, null, null])
    expect(fields.authMechanism).toBe('none')
  })

  it('turns blanks into null and drops the client certificate when TLS is off', () => {
    const fields = buildMongoFields(shared({ username: '', useTls: false }), mongo({ replicaSetName: '' }))
    expect(fields.replicaSetName).toBe(null)
    expect(fields.username).toBe(null)
    expect(fields.tlsCertKeyFile).toBe(null)
  })
})
