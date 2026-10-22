import { describe, it, expect } from 'vitest'
import { parseMySqlUri } from './parseUri.js'

describe('parseMySqlUri', () => {
  it('reads the user, password, host, port and database, decoding escapes', () => {
    expect(parseMySqlUri('mysql://app%20user:s%40cret@db.example.com:3307/%D0%BF%D1%80%D0%BE%D0%B4%D0%B0%D0%B6%D0%B8?ssl-mode=REQUIRED')).toEqual({
      username: 'app user', password: 's@cret',
      hosts: [{ host: 'db.example.com', port: 3307 }],
      database: 'продажи',
      tls: true, tlsAllowInvalidCerts: true, tlsCaFile: null,
    })
  })

  it('leaves what the string doesn\'t say to the form\'s defaults', () => {
    expect(parseMySqlUri('mysql://localhost')).toEqual({
      username: null, password: null, hosts: [{ host: 'localhost', port: 3306 }], database: null,
      tls: null, tlsAllowInvalidCerts: null, tlsCaFile: null,
    })
  })

  it('reads ssl-mode as the editor\'s TLS switches, in any case', () => {
    const tls = (mode) => {
      const { tls, tlsAllowInvalidCerts } = parseMySqlUri(`mysql://h/db?ssl-mode=${mode}`)
      return [tls, tlsAllowInvalidCerts]
    }
    expect(tls('DISABLED')).toEqual([false, null])
    expect(tls('preferred')).toEqual([false, null])
    expect(tls('Required')).toEqual([true, true])
    expect(tls('VERIFY_CA')).toEqual([true, false])
    expect(tls('verify_identity')).toEqual([true, false])
    expect(parseMySqlUri('mysql://h/db?ssl-mode=VERIFY_IDENTITY&ssl-ca=/etc/my%20ca.pem').tlsCaFile).toBe('/etc/my ca.pem')
  })

  it('reads the sslMode and sslmode spellings of ssl-mode', () => {
    expect(parseMySqlUri('mysql://h/db?sslMode=VERIFY_CA').tls).toBe(true)
    expect(parseMySqlUri('mysql://h/db?sslmode=disabled').tls).toBe(false)
  })

  it('reads the sslca and ssl_ca spellings of ssl-ca', () => {
    expect(parseMySqlUri('mysql://h/db?sslca=/etc/my%20ca.pem').tlsCaFile).toBe('/etc/my ca.pem')
    expect(parseMySqlUri('mysql://h/db?ssl_ca=/etc/ca.pem').tlsCaFile).toBe('/etc/ca.pem')
  })

  it('refuses another engine\'s connection string', () => {
    expect(parseMySqlUri('postgresql://localhost')).toBe(null)
  })

  it('refuses PostgreSQL\'s spelling of an ssl-mode', () => {
    expect(parseMySqlUri('mysql://h/db?ssl-mode=require')).toBe(null)
  })
})
