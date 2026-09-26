import { describe, it, expect, vi } from 'vitest'
import { useMongoFields } from './useMongoFields.js'

function setup(editConn = null, { connType, authMode } = {}) {
  const pickCertificate = vi.fn()
  const m = useMongoFields(editConn, { pickCertificate })
  if (connType) m.connType.value = connType
  if (authMode) m.authMode.value = authMode
  return Object.assign(m, { pickCertificate })
}

const stored = (over = {}) => ({ id: 'c1', connection_type: 'standalone', options: {}, ...over })

describe('seeding', () => {
  it('starts a new connection as a standalone SCRAM login against admin', () => {
    const m = setup()
    expect([m.connType.value, m.replicaSetName.value, m.authMode.value, m.authDb.value, m.tlsCertKeyFile.value])
      .toEqual(['standalone', '', 'SCRAM-SHA-256', 'admin', ''])
  })

  it('reads topology, auth and the client certificate from a stored connection', () => {
    const m = setup(stored({
      connection_type: 'replica', replica_set_name: 'rs0',
      auth_mechanism: 'X509', auth_db: '$external', tls_cert_key_file: '/client.pem',
    }))
    expect([m.connType.value, m.replicaSetName.value, m.authMode.value, m.authDb.value, m.tlsCertKeyFile.value])
      .toEqual(['replica', 'rs0', 'X509', '$external', '/client.pem'])
  })

  it('counts only replica sets and sharded clusters as multi-host', () => {
    const m = setup()
    expect(['standalone', 'replica', 'sharded', 'srv'].map(t => { m.connType.value = t; return m.isMultiHost.value }))
      .toEqual([false, true, true, false])
  })
})

describe('pickClientCert', () => {
  it('stores the picked path, and keeps the old one when the picker is dismissed', async () => {
    const m = setup()
    m.pickCertificate.mockResolvedValueOnce('/client.pem')
    await m.pickClientCert()
    expect(m.tlsCertKeyFile.value).toBe('/client.pem')

    m.pickCertificate.mockResolvedValueOnce(null)
    await m.pickClientCert()
    expect(m.tlsCertKeyFile.value).toBe('/client.pem')
  })
})

describe('buildOptions', () => {
  it('omits unset options so the URI carries only real parameters', () => {
    const m = setup()
    m.advancedOptions.value.retryWrites = 'true'
    const out = m.buildOptions()
    expect(out.retryWrites).toBe('true')
    expect('socketTimeoutMS' in out).toBe(false)
  })

  it('carries read preference, but only when the connection type has one', () => {
    const m = setup()
    m.readPreference.value = 'nearest'
    // Standalone has no read preference at all.
    expect('readPreference' in m.buildOptions()).toBe(false)

    m.connType.value = 'replica'
    expect(m.buildOptions().readPreference).toBe('nearest')
  })

  it('preserves stored options that have no field in the editor', () => {
    // A key from a newer driver, or hand-edited JSON — saving must not drop it.
    const m = setup(stored({ options: { zlibCompressionLevel: '6' } }))
    expect(m.buildOptions().zlibCompressionLevel).toBe('6')
  })

  it('emits authMechanismProperties for OIDC and removes it otherwise', () => {
    const m = setup(null, { authMode: 'OIDC' })
    m.oidcEnvironment.value = 'gcp'
    m.oidcTokenResource.value = 'api://x'
    expect(m.buildOptions().authMechanismProperties).toBe('ENVIRONMENT:gcp,TOKEN_RESOURCE:api://x')

    m.authMode.value = 'SCRAM-SHA-256'
    expect('authMechanismProperties' in m.buildOptions()).toBe(false)
  })

  it('leaves out the token resource for an environment that has none', () => {
    const m = setup(null, { authMode: 'OIDC' })
    m.oidcEnvironment.value = 'test'
    m.oidcTokenResource.value = 'api://x'
    expect(m.buildOptions().authMechanismProperties).toBe('ENVIRONMENT:test')
  })
})

describe('edit-mode seeding', () => {
  it('recovers the OIDC environment and token resource from stored properties', () => {
    const m = setup(stored({
      auth_mechanism: 'OIDC',
      options: { authMechanismProperties: 'ENVIRONMENT:gcp,TOKEN_RESOURCE:api://x:y' },
    }))
    expect(m.oidcEnvironment.value).toBe('gcp')
    // Split on the first colon only, so a resource containing one survives.
    expect(m.oidcTokenResource.value).toBe('api://x:y')
  })

  it('seeds the read preference and opens only the groups that hold a value', () => {
    const m = setup(stored({ options: { readPreference: 'secondary', socketTimeoutMS: '9000' } }))
    expect(m.readPreference.value).toBe('secondary')
    const opened = Object.entries(m.openGroups.value).filter(([, open]) => open)
    expect(opened).toHaveLength(1)
  })
})

describe('applyParsed', () => {
  it('fills topology, auth, options and OIDC from a connection string', () => {
    const m = setup()
    m.applyParsed({
      connectionType: 'replica',
      replicaSetName: 'rs0',
      authMode: 'SCRAM-SHA-1',
      authDb: 'users',
      tlsCertKeyFile: '/c.pem',
      readPreference: 'nearest',
      oidcEnvironment: 'azure',
      oidcTokenResource: null,
      advancedOptions: { retryWrites: 'false' },
      extraOptions: { futureKey: '1' },
    })
    expect([m.connType.value, m.replicaSetName.value, m.authMode.value, m.authDb.value, m.tlsCertKeyFile.value])
      .toEqual(['replica', 'rs0', 'SCRAM-SHA-1', 'users', '/c.pem'])
    expect(m.buildOptions()).toMatchObject({ readPreference: 'nearest', retryWrites: 'false', futureKey: '1' })
    expect(m.oidcTokenResource.value).toBe('')
  })
})
