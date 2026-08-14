import { describe, it, expect } from 'vitest'
import { partitionUriOptions, parseConnectionUri } from './connectionUri'

const KNOWN = ['retryWrites', 'w', 'appName', 'socketTimeoutMS', 'readConcernLevel']

function partition(query) {
  return partitionUriOptions(new URLSearchParams(query), KNOWN)
}

describe('partitionUriOptions', () => {
  it('routes catalog keys to `known`', () => {
    const out = partition('retryWrites=true&w=majority&socketTimeoutMS=5000')
    expect(out.known).toEqual({ retryWrites: 'true', w: 'majority', socketTimeoutMS: '5000' })
    expect(out.extra).toEqual({})
  })

  it('matches catalog keys case-insensitively but keeps the canonical key', () => {
    const out = partition('retrywrites=false&APPNAME=svc')
    expect(out.known).toEqual({ retryWrites: 'false', appName: 'svc' })
  })

  it('keeps unrecognized keys verbatim in `extra`', () => {
    const out = partition('directConnection=true&compressors=zstd')
    expect(out.extra).toEqual({ directConnection: 'true', compressors: 'zstd' })
  })

  it('pulls read preference into its dedicated field', () => {
    const out = partition('readPreference=secondaryPreferred')
    expect(out.readPreference).toBe('secondaryPreferred')
    expect(out.known.readPreference).toBeUndefined()
    expect(out.extra.readPreference).toBeUndefined()
  })

  it('pulls TLS file paths into dedicated fields and enables TLS', () => {
    const out = partition('tlsCAFile=/etc/ca.pem&tlsCertificateKeyFile=/etc/client.pem')
    expect(out.tlsCaFile).toBe('/etc/ca.pem')
    expect(out.tlsCertKeyFile).toBe('/etc/client.pem')
    expect(out.tls).toBe(true)
  })

  it('accepts the legacy ssl* file aliases', () => {
    const out = partition('sslCertificateAuthorityFile=/ca.pem&sslPEMKeyFile=/client.pem')
    expect(out.tlsCaFile).toBe('/ca.pem')
    expect(out.tlsCertKeyFile).toBe('/client.pem')
  })

  it('skips structural keys handled elsewhere', () => {
    const out = partition('replicaSet=rs0&authSource=admin&authMechanism=SCRAM-SHA-256&tls=true')
    expect(out.known).toEqual({})
    expect(out.extra).toEqual({})
  })
})

describe('parseConnectionUri', () => {
  const parse = (raw) => parseConnectionUri(raw, KNOWN)

  it('rejects anything that is not a mongodb connection string', () => {
    expect(parse('postgres://localhost:5432')).toBe(null)
    expect(parse('localhost:27017')).toBe(null)
    expect(parse('')).toBe(null)
  })

  it('reads a plain host and port', () => {
    const out = parse('mongodb://db1:27018')
    expect(out.hosts).toEqual([{ host: 'db1', port: 27018 }])
    expect(out.connectionType).toBe('standalone')
  })

  it('defaults a missing port and a missing host', () => {
    expect(parse('mongodb://db1').hosts).toEqual([{ host: 'db1', port: 27017 }])
    expect(parse('mongodb://').hosts).toEqual([{ host: 'localhost', port: 27017 }])
  })

  it('reads a multi-host seed list', () => {
    expect(parse('mongodb://a:1,b:2,c').hosts).toEqual([
      { host: 'a', port: 1 },
      { host: 'b', port: 2 },
      { host: 'c', port: 27017 },
    ])
  })

  it('leaves an IPv6 literal intact', () => {
    // The host:port split works from the last ':', which would otherwise cut the address.
    expect(parse('mongodb://[::1]').hosts).toEqual([{ host: '[::1]', port: 27017 }])
  })

  it('treats +srv as a single hostname with no port', () => {
    const out = parse('mongodb+srv://cluster.example.net')
    expect(out.connectionType).toBe('srv')
    expect(out.hosts).toEqual([{ host: 'cluster.example.net', port: 27017 }])
  })

  it('splits credentials at the last @ so a password may contain one', () => {
    const out = parse('mongodb://user:p@ss@db1:27017')
    expect(out.username).toBe('user')
    expect(out.password).toBe('p@ss')
    expect(out.hosts).toEqual([{ host: 'db1', port: 27017 }])
  })

  it('decodes percent-encoded credentials', () => {
    const out = parse('mongodb://a%40b:p%3Aw@db1')
    expect(out.username).toBe('a@b')
    expect(out.password).toBe('p:w')
  })

  it('reports no credentials rather than blank ones when there is no userinfo', () => {
    // null means "the URI said nothing" — the form keeps whatever it already had.
    const out = parse('mongodb://db1')
    expect(out.username).toBe(null)
    expect(out.password).toBe(null)
  })

  it('turns replicaSet into a replica-set connection', () => {
    const out = parse('mongodb://a:1,b:2/?replicaSet=rs0')
    expect(out.connectionType).toBe('replica')
    expect(out.replicaSetName).toBe('rs0')
  })

  it('takes the auth database from the path, and lets authSource win', () => {
    expect(parse('mongodb://db1/records').authDb).toBe('records')
    expect(parse('mongodb://db1/records?authSource=admin').authDb).toBe('admin')
    expect(parse('mongodb://db1').authDb).toBe('admin')
  })

  it('maps canonical auth mechanisms back to the editor short names', () => {
    expect(parse('mongodb://u:p@db1?authMechanism=MONGODB-X509').authMode).toBe('X509')
    expect(parse('mongodb://u:p@db1?authMechanism=MONGODB-AWS').authMode).toBe('AWS')
    expect(parse('mongodb://u:p@db1?authMechanism=SCRAM-SHA-1').authMode).toBe('SCRAM-SHA-1')
  })

  it('infers no-auth only when the string carries neither mechanism nor user', () => {
    expect(parse('mongodb://db1').authMode).toBe('none')
    // A username with no stated mechanism leaves the choice to the form's default.
    expect(parse('mongodb://u:p@db1').authMode).toBe(null)
  })

  it('recovers the OIDC environment and token resource', () => {
    const out = parse(
      'mongodb://db1?authMechanism=MONGODB-OIDC' +
      '&authMechanismProperties=ENVIRONMENT:gcp,TOKEN_RESOURCE:api://x:y',
    )
    expect(out.authMode).toBe('OIDC')
    expect(out.oidcEnvironment).toBe('gcp')
    // Split on the first colon only, so a resource that contains one survives.
    expect(out.oidcTokenResource).toBe('api://x:y')
  })

  it('leaves OIDC fields alone for other mechanisms', () => {
    const out = parse('mongodb://db1?authMechanismProperties=ENVIRONMENT:gcp')
    expect(out.oidcEnvironment).toBe(null)
    expect(out.oidcTokenResource).toBe(null)
  })

  it('enables TLS from either tls or ssl', () => {
    expect(parse('mongodb://db1?tls=true').tls).toBe(true)
    expect(parse('mongodb://db1?ssl=true').tls).toBe(true)
    expect(parse('mongodb://db1?tls=true&tlsAllowInvalidCertificates=true').tlsAllowInvalidCerts).toBe(true)
    expect(parse('mongodb://db1').tls).toBe(null)
  })

  it('routes the remaining options to the advanced tab, dedicated fields, and extras', () => {
    const out = parse('mongodb://db1?retryWrites=true&readPreference=nearest&tlsCAFile=/ca.pem&zlibLevel=6')
    expect(out.advancedOptions).toEqual({ retryWrites: 'true' })
    expect(out.extraOptions).toEqual({ zlibLevel: '6' })
    expect(out.readPreference).toBe('nearest')
    expect(out.tlsCaFile).toBe('/ca.pem')
    // A TLS file implies TLS even when the string never says tls=true.
    expect(out.tls).toBe(true)
  })
})
