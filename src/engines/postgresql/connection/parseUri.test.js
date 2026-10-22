import { describe, it, expect } from 'vitest'
import { parsePostgresUri } from './parseUri.js'

describe('parsePostgresUri', () => {
  it('reads the user, password, host, port and database, decoding escapes', () => {
    expect(parsePostgresUri('postgresql://app:s%40cret@db.example.com:5433/pay%20ments?sslmode=require')).toEqual({
      username: 'app', password: 's@cret',
      hosts: [{ host: 'db.example.com', port: 5433 }],
      database: 'pay ments',
      tls: true, tlsAllowInvalidCerts: true, tlsCaFile: null,
    })
  })

  it('leaves what the string doesn\'t say to the form\'s defaults', () => {
    expect(parsePostgresUri('postgres://localhost')).toEqual({
      username: null, password: null, hosts: [{ host: 'localhost', port: 5432 }], database: null,
      tls: null, tlsAllowInvalidCerts: null, tlsCaFile: null,
    })
  })

  it('reads sslmode as the editor\'s TLS switches', () => {
    const tls = (mode) => {
      const { tls, tlsAllowInvalidCerts } = parsePostgresUri(`postgresql://h/db?sslmode=${mode}`)
      return [tls, tlsAllowInvalidCerts]
    }
    expect(tls('disable')).toEqual([false, null])
    expect(tls('prefer')).toEqual([false, null])
    expect(tls('require')).toEqual([true, true])
    expect(tls('verify-full')).toEqual([true, false])
    expect(tls('verify-ca')).toEqual([true, false])
    expect(parsePostgresUri('postgresql://h/db?sslmode=verify-full&sslrootcert=/etc/ca.pem').tlsCaFile).toBe('/etc/ca.pem')
  })

  it('refuses another engine\'s connection string', () => {
    expect(parsePostgresUri('mongodb://localhost')).toBe(null)
  })

  it('refuses an sslmode spelled in another case', () => {
    expect(parsePostgresUri('postgresql://h/db?sslmode=REQUIRE')).toBe(null)
  })
})
