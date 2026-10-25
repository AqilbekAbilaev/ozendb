import { describe, it, expect } from 'vitest'
import { GRANT_LEVELS, privilegesFor, privilegeChange } from './grantRows'

const account = { user: "o'brien ü", host: '10.%' }
const draft = (fields) => ({ level: 'database', database: 'shop `eu`', table: '', privileges: ['SELECT'], grantOption: false, ...fields })

describe('privilegesFor', () => {
  it('offers each level its own privileges and every one below it', () => {
    expect(GRANT_LEVELS).toEqual(['server', 'database', 'table'])
    expect(privilegesFor('table')).toContain('SELECT')
    expect(privilegesFor('table')).not.toContain('EXECUTE')
    expect(privilegesFor('database')).toEqual(expect.arrayContaining(['SELECT', 'EXECUTE']))
    expect(privilegesFor('database')).not.toContain('PROCESS')
    expect(privilegesFor('server')).toEqual(expect.arrayContaining(['SELECT', 'EXECUTE', 'PROCESS']))
  })
})

describe('privilegeChange', () => {
  it('names the database alone for a database grant', () => {
    expect(privilegeChange(account, draft({ table: 'ignored', grantOption: true }))).toEqual({
      change: { ...account, database: 'shop `eu`', table: null, privileges: ['SELECT'], grantOption: true },
    })
  })

  it('names neither for the whole server, and both for a table', () => {
    expect(privilegeChange(account, draft({ level: 'server', privileges: ['PROCESS'] })).change).toMatchObject({ database: null, table: null })
    expect(privilegeChange(account, draft({ level: 'table', table: ' order items ' })).change).toMatchObject({ database: 'shop `eu`', table: 'order items' })
  })

  it('keeps only the privileges the level takes, in the order they are offered', () => {
    expect(privilegeChange(account, draft({ level: 'table', table: 'orders', privileges: ['UPDATE', 'EXECUTE', 'SELECT'] })).change.privileges).toEqual(['SELECT', 'UPDATE'])
  })

  it('says what the form still needs', () => {
    expect(privilegeChange(account, draft({ database: ' ' }))).toEqual({ error: 'Enter a database.' })
    expect(privilegeChange(account, draft({ level: 'table' }))).toEqual({ error: 'Enter the table name.' })
    expect(privilegeChange(account, draft({ privileges: [] }))).toEqual({ error: 'Choose at least one privilege.' })
  })
})
