import { describe, it, expect, vi, beforeEach } from 'vitest'

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

const { invoke } = await import('@tauri-apps/api/core')

describe('refusing an edit to a live connection', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockImplementation((cmd) =>
      Promise.resolve(cmd === 'is_connected' ? true : cmd === 'save_connection' ? 'new-id' : {}))
  })

  it('refuses when the edit moves a connected connection to another server', async () => {
    const f = useConnectionForm(stored())
    f.hosts.value = [{ host: 'db2', port: 27017 }]

    expect(await f.save()).toBe(null)
    expect(f.blockedByLiveConnection.value).toBe(true)
    expect(invoke).not.toHaveBeenCalledWith('update_connection', expect.anything())
  })

  it('allows changes that leave the target alone, even while connected', async () => {
    // A rename or a timeout applies to a live connection safely — the pool is evicted
    // and the next operation reconnects.
    const f = useConnectionForm(stored())
    f.connName.value = 'renamed'
    f.advancedOptions.value.socketTimeoutMS = '9000'

    expect(await f.save()).not.toBe(null)
    expect(f.blockedByLiveConnection.value).toBe(false)
  })

  it('allows moving a connection that is not connected', async () => {
    invoke.mockImplementation((cmd) => Promise.resolve(cmd === 'is_connected' ? false : {}))
    const f = useConnectionForm(stored())
    f.hosts.value = [{ host: 'db2', port: 27017 }]

    expect(await f.save()).not.toBe(null)
    expect(f.blockedByLiveConnection.value).toBe(false)
  })

  it('clears the refusal when the next save attempt is allowed', async () => {
    const f = useConnectionForm(stored())
    f.hosts.value = [{ host: 'db2', port: 27017 }]
    await f.save()
    expect(f.blockedByLiveConnection.value).toBe(true)

    f.hosts.value = [{ host: 'db1', port: 27017 }]
    await f.save()
    expect(f.blockedByLiveConnection.value).toBe(false)
  })
})

describe('saveAsNew', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockImplementation((cmd) => Promise.resolve(cmd === 'save_connection' ? 'new-id' : true))
  })

  it('creates a separate connection and leaves the edited one untouched', async () => {
    const f = useConnectionForm(stored())
    f.hosts.value = [{ host: 'db2', port: 27017 }]

    const result = await f.saveAsNew()
    expect(result.event).toBe('saved')
    expect(result.conn.id).toBe('new-id')
    expect(invoke).not.toHaveBeenCalledWith('update_connection', expect.anything())
  })

  it('tells the backend to inherit the original\'s secrets', async () => {
    // The password field is blank unless retyped — it means "keep the existing one" —
    // so without this the copy is saved with no password and cannot authenticate.
    const f = useConnectionForm(stored())
    await f.saveAsNew()

    const [, args] = invoke.mock.calls.find(([cmd]) => cmd === 'save_connection')
    expect(args.copySecretsFrom).toBe('c1')
    expect(args.fields.password).toBe(null)
  })

  it('does not inherit secrets for a connection created from scratch', async () => {
    const f = useConnectionForm(null)
    f.password.value = 'typed'
    await f.save()

    const [, args] = invoke.mock.calls.find(([cmd]) => cmd === 'save_connection')
    expect(args.copySecretsFrom).toBe(null)
    expect(args.fields.password).toBe('typed')
  })

  it('suffixes the name only when it would collide with the original', async () => {
    const same = useConnectionForm(stored())
    expect((await same.saveAsNew()).conn.name).toBe('prod (copy)')

    const renamed = useConnectionForm(stored())
    renamed.connName.value = 'staging'
    expect((await renamed.saveAsNew()).conn.name).toBe('staging')
  })
})
