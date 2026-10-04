import { describe, it, expect } from 'vitest'
import { GRANT_KINDS, privilegesFor, groupGrants, revokeChange, grantChange } from './grantRows'

describe('privilegesFor', () => {
  // Mirrors kind_rules in grants.rs, which refuses anything else.
  it('lists what each grantable kind takes', () => {
    expect(GRANT_KINDS).toEqual(['schema', 'table', 'sequence'])
    expect(privilegesFor('schema')).toEqual(['USAGE', 'CREATE'])
    expect(privilegesFor('table')).toEqual(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'])
    expect(privilegesFor('view')).toEqual(privilegesFor('table'))
    expect(privilegesFor('sequence')).toEqual(['USAGE', 'SELECT', 'UPDATE'])
    expect(privilegesFor('function')).toEqual([])
  })
})

describe('groupGrants', () => {
  it('groups by schema, then object, joining privileges', () => {
    const rows = [
      { objectKind: 'schema', schema: 'public', object: null, privilege: 'USAGE', grantable: false },
      { objectKind: 'table', schema: 'public', object: 'orders', privilege: 'SELECT', grantable: true },
      { objectKind: 'table', schema: 'public', object: 'orders', privilege: 'INSERT', grantable: false },
      { objectKind: 'sequence', schema: 'audit', object: 'log_id_seq', privilege: 'USAGE', grantable: false },
    ]
    expect(groupGrants(rows)).toEqual([
      { schema: 'public', objects: [
        { object: null, objectKind: 'schema', privileges: ['USAGE'] },
        { object: 'orders', objectKind: 'table', privileges: ['SELECT', 'INSERT'] },
      ] },
      { schema: 'audit', objects: [{ object: 'log_id_seq', objectKind: 'sequence', privileges: ['USAGE'] }] },
    ])
  })
})

describe('revokeChange', () => {
  it('revokes everything a row lists, cascading only when asked', () => {
    const obj = { object: 'orders', objectKind: 'view', privileges: ['SELECT', 'INSERT'] }
    expect(revokeChange('app', 'public', obj, false)).toEqual({
      role: 'app', objectKind: 'view', schema: 'public', object: 'orders',
      privileges: ['SELECT', 'INSERT'], cascade: false,
    })
    expect(revokeChange('app', 'public', { object: null, objectKind: 'schema', privileges: ['USAGE'] }, true))
      .toEqual(expect.objectContaining({ object: null, objectKind: 'schema', cascade: true }))
  })
})

describe('grantChange', () => {
  const draft = { kind: 'table', schema: ' public ', object: ' orders ', privileges: ['SELECT'], grantOption: true }

  it('builds a trimmed change from a complete draft', () => {
    expect(grantChange('app', draft)).toEqual({ change: {
      role: 'app', objectKind: 'table', schema: 'public', object: 'orders',
      privileges: ['SELECT'], grantOption: true,
    } })
  })

  it('drops the object for a schema grant', () => {
    expect(grantChange('app', { ...draft, kind: 'schema', privileges: ['USAGE'] }).change.object).toBeNull()
  })

  it('keeps only the privileges the kind takes', () => {
    expect(grantChange('app', { ...draft, kind: 'sequence', privileges: ['USAGE', 'INSERT'] }).change.privileges)
      .toEqual(['USAGE'])
  })

  it('names what is missing instead of building a change', () => {
    expect(grantChange('app', { ...draft, schema: ' ' })).toEqual({ error: 'Enter a schema.' })
    expect(grantChange('app', { ...draft, object: '' })).toEqual({ error: 'Enter the table name.' })
    expect(grantChange('app', { ...draft, privileges: [] })).toEqual({ error: 'Choose at least one privilege.' })
  })
})
