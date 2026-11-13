import { describe, it, expect } from 'vitest'
import { parseMariaDbUri } from './parseUri.js'

describe('parseMariaDbUri', () => {
  it('reads a mariadb:// string, decoding escapes', () => {
    expect(parseMariaDbUri('mariadb://app%20user:s%40cret@db.example.com:3307/%D0%BF%D1%80%D0%BE%D0%B4%D0%B0%D0%B6%D0%B8?ssl-mode=VERIFY_CA')).toEqual({
      username: 'app user', password: 's@cret',
      hosts: [{ host: 'db.example.com', port: 3307 }],
      database: 'продажи',
      tls: true, tlsAllowInvalidCerts: false, tlsCaFile: null,
    })
  })

  it('reads a mysql:// string too, as MariaDB clients accept it', () => {
    expect(parseMariaDbUri('mysql://u@h.example.com:3310/shop ü')).toMatchObject({ username: 'u', hosts: [{ host: 'h.example.com', port: 3310 }], database: 'shop ü' })
  })

  it('falls back to the port 3306 when the string names none', () => {
    expect(parseMariaDbUri('mariadb://localhost').hosts).toEqual([{ host: 'localhost', port: 3306 }])
  })

  it('refuses another engine\'s connection string', () => {
    expect(parseMariaDbUri('postgresql://localhost')).toBe(null)
  })
})
