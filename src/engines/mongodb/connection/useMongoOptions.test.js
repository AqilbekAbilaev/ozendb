import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useMongoOptions } from './useMongoOptions.js'

// The two form fields these options depend on, as the form would pass them.
function setup(editConn = null, { connType = 'standalone', authMode = 'SCRAM-SHA-256' } = {}) {
  const deps = { connType: ref(connType), authMode: ref(authMode) }
  return { ...useMongoOptions(editConn, deps), ...deps }
}

const stored = (over = {}) => ({ id: 'c1', connection_type: 'standalone', options: {}, ...over })

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
  it('fills the options, read preference and OIDC settings from a connection string', () => {
    const m = setup()
    m.applyParsed({
      readPreference: 'nearest',
      oidcEnvironment: 'azure',
      oidcTokenResource: null,
      advancedOptions: { retryWrites: 'false' },
      extraOptions: { futureKey: '1' },
    })
    m.connType.value = 'replica'
    expect(m.buildOptions()).toMatchObject({ readPreference: 'nearest', retryWrites: 'false', futureKey: '1' })
    expect(m.oidcTokenResource.value).toBe('')
  })
})
