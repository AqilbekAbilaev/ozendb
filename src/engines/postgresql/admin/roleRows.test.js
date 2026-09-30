import { describe, it, expect } from 'vitest'
import { roleAttributes, matchRoles, membersOf, canDropRole } from './roleRows'

const ROLES = [
  { name: 'postgres', canLogin: true, superuser: true, createRole: true, createDb: true, replication: true, bypassRls: true, connectionLimit: -1, validUntil: null, memberOf: [], system: false },
  { name: 'app', canLogin: true, superuser: false, createRole: false, createDb: false, replication: false, bypassRls: false, connectionLimit: 20, validUntil: '2027-01-01 00:00:00+00', memberOf: ['readers'], system: false },
  { name: 'readers', canLogin: false, superuser: false, createRole: false, createDb: false, replication: false, bypassRls: false, connectionLimit: -1, validUntil: null, memberOf: [], system: false },
  { name: 'pg_read_all_stats', canLogin: false, superuser: false, createRole: false, createDb: false, replication: false, bypassRls: false, connectionLimit: -1, validUntil: null, memberOf: [], system: true },
]

describe('roleAttributes', () => {
  it('names only the attributes a role actually has', () => {
    expect(roleAttributes(ROLES[1])).toEqual(['Login'])
  })

  it('lists them in a fixed order, strongest first', () => {
    expect(roleAttributes(ROLES[0])).toEqual(['Login', 'Superuser', 'Create role', 'Create DB', 'Replication', 'Bypass RLS'])
  })

  it('says a role can do nothing rather than showing an empty row', () => {
    expect(roleAttributes(ROLES[2])).toEqual(['No login'])
  })

  it('reports a connection limit only when there is one', () => {
    expect(roleAttributes(ROLES[1], { withLimit: true })).toContain('Max 20 connections')
    expect(roleAttributes(ROLES[0], { withLimit: true })).not.toContain('Max -1 connections')
  })
})

describe('membersOf', () => {
  // The backend reports membership one way (who a role belongs to); reading the same
  // edges backwards is how the panel answers "who is in this group".
  it('finds the roles that belong to a group', () => {
    expect(membersOf(ROLES, 'readers')).toEqual(['app'])
  })

  it('is empty for a group nobody belongs to', () => {
    expect(membersOf(ROLES, 'postgres')).toEqual([])
  })

  it('is empty for a role that does not exist', () => {
    expect(membersOf(ROLES, 'nope')).toEqual([])
  })
})

describe('canDropRole', () => {
  it('refuses a role Postgres itself owns', () => {
    expect(canDropRole(ROLES[3], 'postgres')).toEqual({ ok: false, reason: 'PostgreSQL manages this role.' })
  })

  it('refuses the role you are connected as', () => {
    expect(canDropRole(ROLES[0], 'postgres')).toEqual({ ok: false, reason: 'You are connected as this role.' })
  })

  it('allows an ordinary role', () => {
    expect(canDropRole(ROLES[1], 'postgres')).toEqual({ ok: true })
  })
})

describe('matchRoles', () => {
  it('returns every non-system role by default', () => {
    expect(matchRoles(ROLES, {}).map(r => r.name)).toEqual(['postgres', 'app', 'readers'])
  })

  it('includes the system roles when asked', () => {
    expect(matchRoles(ROLES, { showSystem: true })).toHaveLength(4)
  })

  it('matches a name, whatever the case', () => {
    expect(matchRoles(ROLES, { search: 'APP' }).map(r => r.name)).toEqual(['app'])
  })

  it('matches a group a role belongs to, so a group finds its members', () => {
    expect(matchRoles(ROLES, { search: 'readers' }).map(r => r.name)).toEqual(['app', 'readers'])
  })

  it('can show only the roles that can log in', () => {
    expect(matchRoles(ROLES, { loginOnly: true }).map(r => r.name)).toEqual(['postgres', 'app'])
  })

  it('finds nothing rather than everything when nothing matches', () => {
    expect(matchRoles(ROLES, { search: 'zzz' })).toEqual([])
  })
})
