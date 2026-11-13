import { describe, it, expect } from 'vitest'
import { engineLabel, brandOf, runsOn } from './connectionOptions.js'

describe('engineLabel', () => {
  it('names a known engine as people write it', () => {
    expect(engineLabel('postgresql')).toBe('PostgreSQL')
  })

  it('falls back to the engine name it was given, rather than failing the screen', () => {
    expect(engineLabel('cockroach db')).toBe('cockroach db')
  })
})

describe('brandOf', () => {
  it('shows a MySQL connection flagged as MariaDB as MariaDB', () => {
    expect(brandOf({ engine: 'mysql', mariadb: true })).toBe('mariadb')
  })

  it('shows an unflagged MySQL connection as MySQL', () => {
    expect(brandOf({ engine: 'mysql' })).toBe('mysql')
  })

  it('shows any other engine as itself, whatever the flag says', () => {
    expect(brandOf({ engine: 'postgresql', mariadb: true })).toBe('postgresql')
  })
})

describe('runsOn', () => {
  it('runs MariaDB on the MySQL engine', () => {
    expect(runsOn('mariadb')).toBe('mysql')
  })

  it('leaves an engine id as it is', () => {
    expect(runsOn('postgresql')).toBe('postgresql')
  })
})
