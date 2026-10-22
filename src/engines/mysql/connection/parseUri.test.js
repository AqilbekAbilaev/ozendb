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

  it('takes an IPv6 host without its brackets', () => {
    expect(parseMySqlUri('mysql://[::1]:3307/db').hosts).toEqual([{ host: '::1', port: 3307 }])
  })

  it('refuses what it can\'t fill the form from', () => {
    expect(parseMySqlUri('postgresql://localhost')).toBe(null)
    expect(parseMySqlUri('mysql://a:3306,b:3306/db')).toBe(null)
    expect(parseMySqlUri('mysql://h/db?ssl-mode=sometimes')).toBe(null)
    expect(parseMySqlUri('mysql://h/db?ssl-mode=constructor')).toBe(null)
    expect(parseMySqlUri('not a uri')).toBe(null)
  })
})
