import { describe, it, expect } from 'vitest'
import { createTableState, migrateTableState, TABLE_STATE_VERSION } from './tableState.js'
import { SAVED_TABLE_STATES } from './tableState.fixtures.js'

const roundTrip = (value) => JSON.parse(JSON.stringify(value))

describe('createTableState', () => {
  it('is a fresh, versioned, JSON-only state with the given page size', () => {
    const state = createTableState({ limit: 50 })
    expect(state).toEqual({
      v: TABLE_STATE_VERSION,
      query: { filterText: {}, filters: [], joins: [], nextJoin: 1, shownColumns: [], orderBy: null, descending: false, limit: 50, offset: 0 },
      mode: 'filter', sql: '',
      paused: { conditions: {}, columns: null, sort: null },
    })
    expect(roundTrip(state)).toEqual(state)
    expect(createTableState().query.limit).toBe(100)
  })
})

describe('migrateTableState', () => {
  for (const { name, state } of SAVED_TABLE_STATES) {
    it(`reads every saved shape as JSON-only current state: ${name}`, () => {
      const migrated = migrateTableState(state)
      expect(migrated.v).toBe(TABLE_STATE_VERSION)
      expect(roundTrip(migrated)).toEqual(migrated)
      expect(migrateTableState({ state: migrated })).toEqual(migrated)
    })
  }

  it('turns a one-pair join into a list of pairs, and keeps no catalog data', () => {
    const { state } = SAVED_TABLE_STATES.find(f => f.name.startsWith('a join saved as one'))
    expect(migrateTableState(state).query.joins).toEqual([
      { key: 'j1', schema: 'public', table: 'regions', kind: 'left', on: [{ column: 'id', equals: 'region_id' }] },
    ])
  })

  it('keys the next join after the saved ones', () => {
    const { state } = SAVED_TABLE_STATES.find(f => f.name.startsWith('a join over several'))
    expect(migrateTableState(state).query.nextJoin).toBe(3)
    expect(migrateTableState({}).query.nextJoin).toBe(1)
  })

  it('starts fresh from a state a newer version of the app wrote', () => {
    expect(migrateTableState({ state: { v: TABLE_STATE_VERSION + 1, query: 'unknown' } })).toEqual(createTableState())
  })
})
