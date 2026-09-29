import { describe, it, expect } from 'vitest'
import { signature, groupBySchema, matchRoutines } from './routineRows'

const ROUTINES = [
  { oid: 1, schema: 'public', name: 'add_up', arguments: 'a integer, b integer', returnType: 'integer', kind: 'function', language: 'sql' },
  { oid: 2, schema: 'public', name: 'add_up', arguments: 'a text, b text', returnType: 'text', kind: 'function', language: 'sql' },
  { oid: 3, schema: 'public', name: 'do_nothing', arguments: '', returnType: null, kind: 'procedure', language: 'plpgsql' },
  { oid: 4, schema: 'billing', name: 'invoice_total', arguments: 'id bigint', returnType: 'numeric', kind: 'function', language: 'plpgsql' },
]

describe('signature', () => {
  it('reads like the call you would write', () => {
    expect(signature(ROUTINES[0])).toBe('add_up(a integer, b integer) → integer')
  })

  it('keeps the empty parentheses for a routine that takes nothing', () => {
    expect(signature(ROUTINES[2])).toBe('do_nothing()')
  })

  it('promises no return value for a procedure', () => {
    expect(signature(ROUTINES[2])).not.toContain('→')
  })

  it('tells two overloads apart', () => {
    expect(signature(ROUTINES[0])).not.toBe(signature(ROUTINES[1]))
  })
})

describe('groupBySchema', () => {
  it('groups in the order the server listed them', () => {
    const groups = groupBySchema(ROUTINES)
    expect(groups.map(g => g.schema)).toEqual(['public', 'billing'])
    expect(groups[0].routines).toHaveLength(3)
    expect(groups[1].routines).toHaveLength(1)
  })

  it('has nothing to group when there is nothing', () => {
    expect(groupBySchema([])).toEqual([])
  })
})

describe('matchRoutines', () => {
  it('returns everything for an empty search', () => {
    expect(matchRoutines(ROUTINES, '  ')).toHaveLength(4)
  })

  it('matches the name, whatever the case', () => {
    expect(matchRoutines(ROUTINES, 'ADD_UP').map(r => r.oid)).toEqual([1, 2])
  })

  it('matches the schema, so one schema can be picked out of all of them', () => {
    expect(matchRoutines(ROUTINES, 'billing').map(r => r.oid)).toEqual([4])
  })

  it('matches the arguments, for finding what takes a given type', () => {
    expect(matchRoutines(ROUTINES, 'bigint').map(r => r.oid)).toEqual([4])
  })

  it('finds nothing rather than everything when nothing matches', () => {
    expect(matchRoutines(ROUTINES, 'zzz')).toEqual([])
  })
})
