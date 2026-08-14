import { describe, it, expect, vi } from 'vitest'

// The composable talks to Tauri only inside save/testConnection; these stubs keep the
// module importable so the field logic — which is what these specs cover — can run.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const { useConnectionForm } = await import('./useConnectionForm.js')

const stored = (over = {}) => ({
  id: 'c1',
  name: 'prod',
  hosts: [{ host: 'db1', port: 27017 }],
  connection_type: 'standalone',
  options: {},
  ...over,
})

describe('formFields', () => {
  it('trims the name and coerces ports to numbers', () => {
    const f = useConnectionForm(null)
    f.connName.value = '  spaced  '
    f.hosts.value = [{ host: 'db1', port: '27018' }]
    expect(f.formFields().name).toBe('spaced')
    expect(f.formFields().hosts).toEqual([{ host: 'db1', port: 27018 }])
  })

  it('sends no credentials at all when auth is none', () => {
    // The fields stay populated behind the hidden tab, so they have to be dropped here
    // rather than relied on being empty.
    const f = useConnectionForm(null)
    f.username.value = 'admin'
    f.password.value = 'secret'
    f.authDb.value = 'admin'
    f.authMode.value = 'none'

    const fields = f.formFields()
    expect(fields.username).toBe(null)
    expect(fields.password).toBe(null)
    expect(fields.authDb).toBe(null)
  })

  it('drops TLS file paths when TLS is off', () => {
    const f = useConnectionForm(null)
    f.tlsCaFile.value = '/ca.pem'
    f.tlsAllowInvalidCerts.value = true
    expect(f.formFields().tlsCaFile).toBe(null)
    expect(f.formFields().tlsAllowInvalidCertificates).toBe(false)
  })

  it('sends only the SSH secret its auth method uses', () => {
    const f = useConnectionForm(null)
    f.useSsh.value = true
    f.sshPassword.value = 'pw'
    f.sshKeyPassphrase.value = 'phrase'

    f.sshAuth.value = 'password'
    expect(f.formFields().sshPassword).toBe('pw')
    expect(f.formFields().sshPassphrase).toBe(null)

    f.sshAuth.value = 'key'
    expect(f.formFields().sshPassword).toBe(null)
    expect(f.formFields().sshPassphrase).toBe('phrase')
  })

  it('drops every SSH field when the tunnel is off', () => {
    const f = useConnectionForm(null)
    f.sshHost.value = 'bastion'
    f.sshUser.value = 'ubuntu'
    expect(f.formFields().sshHost).toBe(null)
    expect(f.formFields().sshUser).toBe(null)
    expect(f.formFields().sshEnabled).toBe(false)
  })

  it('treats the "none" tag as no tag', () => {
    const f = useConnectionForm(null)
    expect(f.formFields().tag).toBe(null)
    f.selectedTag.value = 'red'
    expect(f.formFields().tag).toBe('red')
  })
})

describe('buildOptions', () => {
  it('omits unset options so the URI carries only real parameters', () => {
    const f = useConnectionForm(null)
    f.advancedOptions.value.retryWrites = 'true'
    const out = f.buildOptions()
    expect(out.retryWrites).toBe('true')
    expect('socketTimeoutMS' in out).toBe(false)
  })

  it('carries read preference, but only when the connection type has one', () => {
    const f = useConnectionForm(null)
    f.readPreference.value = 'nearest'
    // Standalone has no read preference at all.
    expect('readPreference' in f.buildOptions()).toBe(false)

    f.connType.value = 'replica'
    expect(f.buildOptions().readPreference).toBe('nearest')
  })

  it('preserves stored options that have no field in the editor', () => {
    // A key from a newer driver, or hand-edited JSON — saving must not drop it.
    const f = useConnectionForm(stored({ options: { zlibCompressionLevel: '6' } }))
    expect(f.buildOptions().zlibCompressionLevel).toBe('6')
  })

  it('emits authMechanismProperties for OIDC and removes it otherwise', () => {
    const f = useConnectionForm(null)
    f.authMode.value = 'OIDC'
    f.oidcEnvironment.value = 'gcp'
    f.oidcTokenResource.value = 'api://x'
    expect(f.buildOptions().authMechanismProperties).toBe('ENVIRONMENT:gcp,TOKEN_RESOURCE:api://x')

    f.authMode.value = 'SCRAM-SHA-256'
    expect('authMechanismProperties' in f.buildOptions()).toBe(false)
  })

  it('leaves out the token resource for an environment that has none', () => {
    const f = useConnectionForm(null)
    f.authMode.value = 'OIDC'
    f.oidcEnvironment.value = 'test'
    f.oidcTokenResource.value = 'api://x'
    expect(f.buildOptions().authMechanismProperties).toBe('ENVIRONMENT:test')
  })
})

describe('edit-mode seeding', () => {
  it('never pre-fills secrets, so blank keeps what is stored', () => {
    const f = useConnectionForm(stored({ username: 'admin' }))
    expect(f.username.value).toBe('admin')
    expect(f.password.value).toBe('')
    expect(f.sshPassword.value).toBe('')
    expect(f.sshKeyPassphrase.value).toBe('')
  })

  it('recovers the OIDC environment and token resource from stored properties', () => {
    const f = useConnectionForm(stored({
      auth_mechanism: 'OIDC',
      options: { authMechanismProperties: 'ENVIRONMENT:gcp,TOKEN_RESOURCE:api://x:y' },
    }))
    expect(f.oidcEnvironment.value).toBe('gcp')
    // Split on the first colon only, so a resource containing one survives.
    expect(f.oidcTokenResource.value).toBe('api://x:y')
  })

  it('round-trips a stored connection back to the same fields', () => {
    const f = useConnectionForm(stored({
      hosts: [{ host: 'a', port: 1 }, { host: 'b', port: 2 }],
      connection_type: 'replica',
      replica_set_name: 'rs0',
      read_only: true,
      tag: 'red',
    }))
    const fields = f.formFields()
    expect(fields.hosts).toEqual([{ host: 'a', port: 1 }, { host: 'b', port: 2 }])
    expect(fields.connectionType).toBe('replica')
    expect(fields.replicaSetName).toBe('rs0')
    expect(fields.readOnly).toBe(true)
    expect(fields.tag).toBe('red')
  })
})
