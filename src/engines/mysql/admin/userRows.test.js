import { describe, it, expect } from 'vitest'
import { accountName, userAttributes, matchUsers, canDropUser } from './userRows'

const user = (fields) => ({ user: 'app', host: '%', plugin: 'caching_sha2_password', locked: false, passwordExpired: false, system: false, current: false, ...fields })

const USERS = [
  user({ user: "o'brien ü", host: '10.%' }),
  user({ user: 'reporting role', locked: true, passwordExpired: true }),
  user({ user: 'mysql.sys', host: 'localhost', locked: true, system: true }),
  user({ user: 'root', host: 'localhost', current: true }),
]

describe('accountName', () => {
  it('names an account as user@host', () => {
    expect(accountName(USERS[0])).toBe("o'brien ü@10.%")
  })

  it('shows the anonymous account\'s empty user rather than nothing', () => {
    expect(accountName(user({ user: '', host: 'localhost' }))).toBe("''@localhost")
  })
})

describe('userAttributes', () => {
  it('says how an account signs in, and whether it may', () => {
    expect(userAttributes(USERS[0])).toEqual(['caching_sha2_password'])
    expect(userAttributes(USERS[1])).toEqual(['Locked', 'Password expired', 'caching_sha2_password'])
  })
})

describe('matchUsers', () => {
  it('hides MySQL\'s reserved accounts unless asked for them', () => {
    expect(matchUsers(USERS, { search: '', showSystem: false }).map(accountName)).not.toContain('mysql.sys@localhost')
    expect(matchUsers(USERS, { search: '', showSystem: true })).toHaveLength(4)
  })

  it('finds an account by its user or its host, ignoring case', () => {
    expect(matchUsers(USERS, { search: "O'BRIEN", showSystem: false }).map(accountName)).toEqual(["o'brien ü@10.%"])
    expect(matchUsers(USERS, { search: 'localhost', showSystem: false }).map(accountName)).toEqual(['root@localhost'])
  })
})

describe('canDropUser', () => {
  it('refuses MySQL\'s own accounts and the one this connection signed in as', () => {
    expect(canDropUser(USERS[2])).toEqual({ ok: false, reason: 'MySQL reserves this account.' })
    expect(canDropUser(USERS[3])).toEqual({ ok: false, reason: 'You are connected as this account.' })
  })

  it('leaves any other account to the server to refuse', () => {
    expect(canDropUser(USERS[1])).toEqual({ ok: true })
  })
})
