import { describe, it, expect, vi, beforeEach } from 'vitest'

// The composable talks to Tauri only inside save/testConnection; these stubs keep the
// module importable so the field logic — which is what these specs cover — can run.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const { useConnectionForm } = await import('./useConnectionForm.js')
const { emit: tauriEmit } = await import('@tauri-apps/api/event')

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
    f.engineFields.mongodb.authDb.value = 'admin'
    f.engineFields.mongodb.authMode.value = 'none'

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

describe('engine', () => {
  it('starts a new connection as MongoDB', () => {
    const fields = useConnectionForm(null).formFields()
    expect(fields.engine).toBe('mongodb')
    expect(fields).not.toHaveProperty('database')
  })

  it('moves a default port to the new engine\'s default and keeps a typed one', () => {
    const f = useConnectionForm(null)
    f.hosts.value = [{ host: 'a', port: 27017 }, { host: 'b', port: 6000 }]

    f.setEngine('postgresql')

    expect(f.engine.value).toBe('postgresql')
    expect(f.hosts.value.map(h => h.port)).toEqual([5432, 6000])
  })

  it('sends PostgreSQL its database and credentials, and none of MongoDB\'s settings', () => {
    const f = useConnectionForm(null)
    f.setEngine('postgresql')
    f.engineFields.postgresql.database.value = ' app '
    f.username.value = 'me'
    f.password.value = 'pw'
    const mongo = f.engineFields.mongodb
    mongo.authMode.value = 'none'
    mongo.connType.value = 'replica'
    mongo.replicaSetName.value = 'rs0'
    f.useTls.value = true
    mongo.tlsCertKeyFile.value = '/client.pem'

    const fields = f.formFields()
    expect(fields).toMatchObject({ engine: 'postgresql', database: 'app', username: 'me', password: 'pw' })
    for (const key of ['connectionType', 'replicaSetName', 'authDb', 'authMechanism', 'options', 'tlsCertKeyFile']) {
      expect(fields, key).not.toHaveProperty(key)
    }
  })

  it('falls back to the engine\'s default port for a blank one', () => {
    const f = useConnectionForm(null)
    f.setEngine('postgresql')
    f.hosts.value = [{ host: 'db', port: '' }]
    expect(f.formFields().hosts).toEqual([{ host: 'db', port: 5432 }])
  })

  it('seeds the engine and database when editing a PostgreSQL connection', () => {
    const f = useConnectionForm(stored({ engine: 'postgresql', database: 'app', hosts: [{ host: 'pg', port: 5432 }] }))
    expect(f.engine.value).toBe('postgresql')
    expect(f.engineFields.postgresql.database.value).toBe('app')
  })
})

describe('saving a new connection', () => {
  it('broadcasts its engine and database, so an Edit before a refetch sees them', async () => {
    invoke.mockReset()
    invoke.mockResolvedValue('new-id')
    const f = useConnectionForm(null)
    f.setEngine('postgresql')
    f.engineFields.postgresql.database.value = 'app'

    const result = await f.save()

    expect(result.conn).toMatchObject({ id: 'new-id', engine: 'postgresql', database: 'app' })
    expect(tauriEmit).toHaveBeenCalledWith('connection-saved', result.conn)
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
const { connDatabases } = await import('../stores/connectionData.js')

// The sidebar having databases loaded for a connection is what makes an edit risky:
// what's on screen came from the server it currently points at.
function sidebarShows(id) {
  connDatabases.value[id] = [{ name: 'admin', collections: [], accessible: true }]
}

describe('refusing an edit that would strand the sidebar', () => {
  beforeEach(() => {
    connDatabases.value = {}
    invoke.mockReset()
    invoke.mockImplementation((cmd) =>
      Promise.resolve(cmd === 'save_connection' ? 'new-id' : {}))
  })

  it('refuses when the edit moves a connection the sidebar is showing', async () => {
    sidebarShows('c1')
    const f = useConnectionForm(stored())
    f.hosts.value = [{ host: 'db2', port: 27017 }]

    expect(await f.save()).toBe(null)
    expect(f.blockedByLiveConnection.value).toBe(true)
    expect(invoke).not.toHaveBeenCalledWith('update_connection', expect.anything())
  })

  it('allows changes that leave the target alone, even while open', async () => {
    // A rename or a timeout applies to a live connection safely — the pool is evicted
    // and the next operation reconnects, and nothing on screen becomes wrong.
    sidebarShows('c1')
    const f = useConnectionForm(stored())
    f.connName.value = 'renamed'
    f.engineFields.mongodb.advancedOptions.value.socketTimeoutMS = '9000'

    expect(await f.save()).not.toBe(null)
    expect(f.blockedByLiveConnection.value).toBe(false)
  })

  it('allows renaming an open PostgreSQL connection', async () => {
    // Stored PostgreSQL records carry no connection_type; that alone isn't a move.
    sidebarShows('c1')
    const pg = stored({ engine: 'postgresql', database: 'app', connection_type: undefined, hosts: [{ host: 'pg', port: 5432 }] })
    const f = useConnectionForm(pg)
    f.connName.value = 'renamed'

    expect(await f.save()).not.toBe(null)
    expect(f.blockedByLiveConnection.value).toBe(false)
  })

  it('allows moving a connection the sidebar is not showing', async () => {
    // Nothing on screen describes the old server, so there is nothing to strand.
    const f = useConnectionForm(stored())
    f.hosts.value = [{ host: 'db2', port: 27017 }]

    expect(await f.save()).not.toBe(null)
    expect(f.blockedByLiveConnection.value).toBe(false)
  })

  it('clears the refusal when the next save attempt is allowed', async () => {
    sidebarShows('c1')
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

  it('copies every setting of the original, changing only the name', async () => {
    const original = stored({
      username: 'admin',
      auth_db: 'authdb',
      auth_mechanism: 'SCRAM-SHA-1',
      hosts: [{ host: 'a', port: 1 }, { host: 'b', port: 2 }],
      connection_type: 'replica',
      replica_set_name: 'rs0',
      tls: true,
      tls_ca_file: '/ca.pem',
      tls_allow_invalid_certificates: true,
      ssh_enabled: true,
      ssh_host: 'bastion',
      ssh_port: 2222,
      ssh_user: 'ubuntu',
      ssh_auth: 'key',
      ssh_key_file: '/id_ed25519',
      tag: 'red',
      read_only: true,
      options: { retryWrites: 'true', zlibCompressionLevel: '6' },
    })
    const f = useConnectionForm(original)
    await f.saveAsNew()

    const [, args] = invoke.mock.calls.find(([cmd]) => cmd === 'save_connection')
    expect(args.fields).toMatchObject({
      username: 'admin',
      authDb: 'authdb',
      authMechanism: 'SCRAM-SHA-1',
      hosts: [{ host: 'a', port: 1 }, { host: 'b', port: 2 }],
      connectionType: 'replica',
      replicaSetName: 'rs0',
      tls: true,
      tlsCaFile: '/ca.pem',
      tlsAllowInvalidCertificates: true,
      sshEnabled: true,
      sshHost: 'bastion',
      sshPort: 2222,
      sshUser: 'ubuntu',
      sshAuth: 'key',
      sshKeyFile: '/id_ed25519',
      tag: 'red',
      readOnly: true,
    })
    expect(args.fields.options).toMatchObject({ retryWrites: 'true', zlibCompressionLevel: '6' })
    // Secrets stay blank in the form; the backend inherits them from the original.
    expect(args.copySecretsFrom).toBe('c1')
    expect(args.fields.name).toBe('prod (copy)')
  })

  it('suffixes the name only when it would collide with the original', async () => {
    const same = useConnectionForm(stored())
    expect((await same.saveAsNew()).conn.name).toBe('prod (copy)')

    const renamed = useConnectionForm(stored())
    renamed.connName.value = 'staging'
    expect((await renamed.saveAsNew()).conn.name).toBe('staging')
  })
})

// The composable's local `testConnection` used to shadow the imported API function
// (same name, fewer arguments): the non-SSH path recursed into itself and never
// reached the backend. These cases pin the API boundary through the real API module,
// which in turn calls the mocked invoke.
describe('testConnection', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockResolvedValue(true)
  })

  it('reaches the backend exactly once for a plain connection', async () => {
    const f = useConnectionForm(null)
    f.hosts.value = [{ host: 'localhost', port: 27017 }]

    await f.testConnection()

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('test_connection', expect.anything())
    expect(f.status.value).toEqual({ type: 'success', message: 'Connected successfully.' })
  })

  it('records an error status when the backend rejects', async () => {
    const f = useConnectionForm(null)
    invoke.mockRejectedValueOnce(new Error('boom'))

    await f.testConnection()

    expect(f.status.value.type).toBe('error')
    expect(f.status.value.message).toContain('boom')
  })

  it('sends an SSH connection through test_connection with its SSH fields', async () => {
    const f = useConnectionForm(null)
    f.useSsh.value = true
    f.sshHost.value = 'bastion'

    await f.testConnection()

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('test_connection', {
      id: null,
      fields: expect.objectContaining({ sshEnabled: true, sshHost: 'bastion' }),
    })
    expect(f.status.value.type).toBe('success')
  })
})

describe('applyParsed for PostgreSQL', () => {
  it('fills the shared fields and the database, and leaves MongoDB\'s alone', () => {
    const f = useConnectionForm(null)
    f.setEngine('postgresql')
    f.applyParsed({
      username: 'app', password: 'pw', hosts: [{ host: 'db', port: 5433 }], database: 'payments',
      tls: true, tlsAllowInvalidCerts: true, tlsCaFile: null,
    })
    expect(f.engineFields.postgresql.database.value).toBe('payments')
    const fields = f.formFields()
    expect(fields).toMatchObject({ username: 'app', password: 'pw', hosts: [{ host: 'db', port: 5433 }], tls: true, tlsAllowInvalidCertificates: true })
  })
})

const { tagOverrides } = await import('../stores/nodeTags.js')

describe('the colour shown on tabs', () => {
  beforeEach(() => {
    tagOverrides.value = {}
    invoke.mockReset()
    // The backend hands back the stored connection, tag included.
    invoke.mockImplementation((cmd, args) => Promise.resolve(
      cmd === 'save_connection' ? 'new-id' : stored({ tag: args.fields.tag })))
  })

  it('takes the colour chosen when editing a connection', async () => {
    // The tab bar reads colours only from tagOverrides, so without this a tab keeps
    // its old colour until the app restarts.
    const f = useConnectionForm(stored())
    f.selectedTag.value = 'red'
    await f.save()
    expect(tagOverrides.value.c1).toBe('red')
  })

  it('drops the colour when the edit sets it to none', async () => {
    tagOverrides.value = { c1: 'red' }
    const f = useConnectionForm(stored({ tag: 'red' }))
    f.selectedTag.value = 'none'
    await f.save()
    expect(tagOverrides.value.c1).toBe('none')
  })

  it('takes the colour of a new connection', async () => {
    const f = useConnectionForm(null)
    f.selectedTag.value = 'blue'
    await f.save()
    expect(tagOverrides.value['new-id']).toBe('blue')
  })
})

const { parseConnectionUri } = await import('../utils/connectionUri.js')
const { KNOWN_OPTION_KEYS } = await import('../data/connectionOptions.js')
const { parseMySqlUri } = await import('../engines/mysql/connection/parseUri.js')

describe('each engine\'s own fields', () => {
  it('are made for every engine', () => {
    const f = useConnectionForm(null)
    expect(Object.keys(f.engineFields).sort()).toEqual(['mongodb', 'mysql', 'postgresql'])
  })

  it('are made only for the edited connection\'s own engine, which cannot change', () => {
    const pg = useConnectionForm(stored({ engine: 'postgresql', database: 'app', hosts: [{ host: 'pg', port: 5432 }] }))
    expect(Object.keys(pg.engineFields)).toEqual(['postgresql'])

    // A record from before engines existed is MongoDB.
    expect(Object.keys(useConnectionForm(stored()).engineFields)).toEqual(['mongodb'])
  })

  it('keep what was typed in MongoDB\'s fields across a switch to PostgreSQL and back', () => {
    const f = useConnectionForm(null)
    const mongo = f.engineFields.mongodb
    mongo.connType.value = 'replica'
    mongo.replicaSetName.value = 'rs-ü 0'
    mongo.advancedOptions.value.appName = 'my app'

    f.setEngine('postgresql')
    f.setEngine('mongodb')

    expect(f.engineFields.mongodb).toBe(mongo)
    expect(f.formFields()).toMatchObject({
      connectionType: 'replica', replicaSetName: 'rs-ü 0', options: { appName: 'my app' },
    })
  })

  it('keep a database name with the SQL engine it was typed for', () => {
    // A PostgreSQL database name rarely means anything on MySQL, so it doesn't follow.
    const f = useConnectionForm(null)
    f.setEngine('postgresql')
    f.engineFields.postgresql.database.value = 'payments'

    f.setEngine('mysql')
    expect(f.formFields().database).toBe(null)
    f.engineFields.mysql.database.value = 'shop'

    f.setEngine('postgresql')
    expect(f.formFields().database).toBe('payments')
  })
})

describe('the payload for each engine', () => {
  // Shared values, irregular on purpose: padding, unicode, string ports.
  function fillShared(f) {
    f.connName.value = '  Prod ü  '
    f.hosts.value = [{ host: 'db-1.example', port: '6001' }, { host: 'db-2', port: '' }]
    f.username.value = 'ad min'
    f.password.value = 'p@ss:/w'
    for (const engine of ['postgresql', 'mysql']) f.engineFields[engine].database.value = '  sales 2024 '
    f.useTls.value = true
    f.tlsCaFile.value = '/ca dir/ca.pem'
    f.tlsAllowInvalidCerts.value = true
    f.useSsh.value = true
    f.sshHost.value = 'bastion'
    f.sshPort.value = '2222'
    f.sshUser.value = 'ubuntu'
    f.sshAuth.value = 'key'
    f.sshKeyFile.value = '/id_ed25519'
    f.sshKeyPassphrase.value = 'phrase'
    f.selectedTag.value = 'red'
    f.readOnly.value = true
  }
  const shared = (engine, defaultPort) => ({
    name: 'Prod ü',
    engine,
    hosts: [{ host: 'db-1.example', port: 6001 }, { host: 'db-2', port: defaultPort }],
    tls: true,
    tlsCaFile: '/ca dir/ca.pem',
    tlsAllowInvalidCertificates: true,
    sshEnabled: true,
    sshHost: 'bastion',
    sshPort: 2222,
    sshUser: 'ubuntu',
    sshAuth: 'key',
    sshKeyFile: '/id_ed25519',
    sshPassword: null,
    sshPassphrase: 'phrase',
    tag: 'red',
    readOnly: true,
  })

  it('carries MongoDB\'s own settings for MongoDB', () => {
    const f = useConnectionForm(null)
    fillShared(f)
    const mongo = f.engineFields.mongodb
    mongo.connType.value = 'replica'
    mongo.replicaSetName.value = 'rs-ü 0'
    mongo.authMode.value = 'SCRAM-SHA-1'
    mongo.authDb.value = '$external'
    mongo.tlsCertKeyFile.value = '/client cert.pem'
    mongo.readPreference.value = 'secondaryPreferred'
    mongo.advancedOptions.value.socketTimeoutMS = '9000'

    expect(f.formFields()).toEqual({
      ...shared('mongodb', 27017),
      connectionType: 'replica',
      replicaSetName: 'rs-ü 0',
      options: { socketTimeoutMS: '9000', readPreference: 'secondaryPreferred' },
      username: 'ad min',
      password: 'p@ss:/w',
      authDb: '$external',
      authMechanism: 'SCRAM-SHA-1',
      tlsCertKeyFile: '/client cert.pem',
    })
  })

  for (const [engine, defaultPort] of [['postgresql', 5432], ['mysql', 3306]]) {
    it(`carries only the database and credentials for ${engine}`, () => {
      const f = useConnectionForm(null)
      f.setEngine(engine)
      fillShared(f)
      f.engineFields.mongodb.connType.value = 'replica'

      expect(f.formFields()).toEqual({
        ...shared(engine, defaultPort),
        database: 'sales 2024',
        username: 'ad min',
        password: 'p@ss:/w',
      })
    })
  }
})

describe('a pasted connection string', () => {
  it('fills MongoDB\'s own fields for MongoDB, and leaves the database alone', () => {
    const f = useConnectionForm(null)
    f.applyParsed(parseConnectionUri(
      'mongodb://app:pw@a:27018,b:27019/sales?replicaSet=rs0&authSource=authdb&readPreference=secondary&appName=x',
      KNOWN_OPTION_KEYS,
    ))

    const mongo = f.engineFields.mongodb
    expect([mongo.connType.value, mongo.replicaSetName.value, mongo.authDb.value, mongo.readPreference.value])
      .toEqual(['replica', 'rs0', 'authdb', 'secondary'])
    expect(mongo.advancedOptions.value.appName).toBe('x')
    expect(f.engineFields.postgresql.database.value).toBe('')
    expect(f.engineFields.mysql.database.value).toBe('')
  })

  it('sets the database for MySQL, and leaves MongoDB\'s fields alone', () => {
    const f = useConnectionForm(null)
    f.setEngine('mysql')
    f.applyParsed(parseMySqlUri('mysql://app:pw@db:3307/shop'))

    expect(f.engineFields.mysql.database.value).toBe('shop')
    expect(f.engineFields.postgresql.database.value).toBe('')
    expect(f.formFields()).toMatchObject({ username: 'app', password: 'pw', hosts: [{ host: 'db', port: 3307 }] })
    expect(f.engineFields.mongodb.connType.value).toBe('standalone')
  })
})
