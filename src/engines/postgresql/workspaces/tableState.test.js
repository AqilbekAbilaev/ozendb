import { describe, it, expect } from 'vitest'
import { createTableState, createTableUi, createTableRuntime, migrateTableState, TABLE_STATE_VERSION } from './tableState.js'
import { createSqlRun } from './runSql.js'
import { SAVED_TABLE_STATES } from './tableState.fixtures.js'

const roundTrip = (value) => JSON.parse(JSON.stringify(value))

describe('createTableState', () => {
  it('is a fresh, versioned, JSON-only state with the given page size', () => {
    const state = createTableState({ limit: 50 })
    expect(state).toEqual({
      v: TABLE_STATE_VERSION,
      query: { filterText: {}, filters: [], joins: [], nextJoin: 1, shownColumns: [], columnOrder: null, orderBy: null, descending: false, limit: 50, offset: 0 },
      mode: 'filter', sql: '',
      paused: { conditions: {}, columns: null, sort: null },
    })
    expect(roundTrip(state)).toEqual(state)
    expect(createTableState().query.limit).toBe(100)
  })
})

describe('migrateTableState', () => {
  it('reads a v1 state as one whose columns keep the order they come in', () => {
    const v1 = { v: 1, query: { ...createTableState().query, shownColumns: ['name'] }, mode: 'sql', sql: 'SELECT 1', paused: createTableState().paused }
    delete v1.query.columnOrder
    expect(migrateTableState({ state: v1 })).toEqual({ ...v1, v: TABLE_STATE_VERSION, query: { ...v1.query, columnOrder: null } })
  })

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

describe('createTableUi', () => {
  it('starts with the builder closed, at its default width, on Result', () => {
    expect(createTableUi()).toEqual({ builderOpen: false, builderWidth: 360, rtab: 'Result' })
  })
})


describe('createTableRuntime', () => {
  it('starts with nothing loaded, and its own SQL and Explain runs on the connection', () => {
    const runtime = createTableRuntime('c1')
    expect(runtime).toMatchObject({
      mainColumns: null, joinColumns: {}, foreignKeys: {}, server: null,
      columns: [], rows: [], total: null, loading: false, error: null, messages: [],
      generation: 0, builtSql: null,
      sqlRun: createSqlRun('c1'), explainRun: createSqlRun('c1'),
    })
    expect(runtime.sqlRun).not.toBe(runtime.explainRun)
  })

  it('selects nothing, apart from what its SQL run selects', () => {
    const runtime = createTableRuntime('c1')
    expect(runtime.selection).toEqual({ selectedRow: -1, selectedRows: [], selectedField: null })
    expect(runtime.sqlRun.selection).toEqual(runtime.selection)
    expect(runtime.sqlRun.selection).not.toBe(runtime.selection)
  })
})
