import { describe, it, expect } from 'vitest'
import { parseSqlUri } from './parseUri.js'

const ENGINE = {
  schemes: ['sq l', 'sql'],
  modeParams: ['ssl.mode', 'sslMode'],
  caParams: ['ssl.ca', 'sslCa'],
  modes: { 'off ü': [false, null], on: [true, true] },
  modeKey: (mode) => mode.toLowerCase(),
  defaultPort: 4321,
}
const parse = (raw) => parseSqlUri(raw, ENGINE)

describe('parseSqlUri', () => {
  it('reads the user, password, host, port, database and CA file, decoding escapes', () => {
    expect(parse('sql://app%20user:s%40cret@db.example.com:4322/%D0%BF%D1%80%D0%BE%D0%B4%D0%B0%D0%B6%D0%B8?ssl.mode=ON&ssl.ca=/etc/my%20ca.pem')).toEqual({
      username: 'app user', password: 's@cret',
      hosts: [{ host: 'db.example.com', port: 4322 }],
      database: 'продажи',
      tls: true, tlsAllowInvalidCerts: true, tlsCaFile: '/etc/my ca.pem',
    })
  })

  it('leaves what the string doesn\'t say to the form\'s defaults', () => {
    expect(parse('sql://localhost')).toEqual({
      username: null, password: null, hosts: [{ host: 'localhost', port: 4321 }], database: null,
      tls: null, tlsAllowInvalidCerts: null, tlsCaFile: null,
    })
  })

  it('takes an IPv6 host without its brackets', () => {
    expect(parse('sql://[::1]:4322/db').hosts).toEqual([{ host: '::1', port: 4322 }])
  })

  it('refuses another scheme', () => {
    expect(parse('sqlite://localhost')).toBe(null)
  })

  it('refuses several hosts', () => {
    expect(parse('sql://a:4321,b:4321/db')).toBe(null)
  })

  it('refuses something that isn\'t a URI', () => {
    expect(parse('not a uri')).toBe(null)
  })

  it('refuses an SSL mode its table doesn\'t have', () => {
    expect(parse('sql://h/db?ssl.mode=sometimes')).toBe(null)
  })

  it('refuses an SSL mode named after a property every object inherits', () => {
    expect(parse('sql://h/db?ssl.mode=constructor')).toBe(null)
  })

  it('refuses a broken percent escape in the user, password or database', () => {
    expect(parse('sql://user%ZZ@h/db')).toBe(null)
    expect(parse('sql://u:p%E0%A4@h/db')).toBe(null)
    expect(parse('sql://h/sales%E0')).toBe(null)
  })
})
