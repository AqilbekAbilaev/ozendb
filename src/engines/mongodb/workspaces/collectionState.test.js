import { describe, it, expect } from 'vitest'
import {
  COLLECTION_STATE_VERSION, createCollectionState,
  createCollectionRuntime, migrateCollectionState,
} from './collectionState'

describe('createCollectionState', () => {
  it('carries its version, so a newer shape is recognised as one', () => {
    expect(createCollectionState().v).toBe(COLLECTION_STATE_VERSION)
  })

  it('takes the query limit from the caller\'s defaults', () => {
    expect(createCollectionState({ queryLimit: 200 }).query.limit).toBe(200)
    expect(createCollectionState().query.limit).toBe(50)
  })

  it('holds only what a user built — nothing fetched', () => {
    const state = createCollectionState()
    expect(Object.keys(state.query).sort()).toEqual(
      ['colOrder', 'filter', 'limit', 'pipeline', 'projection', 'skip', 'sort', 'vqb'],
    )
    expect(state).not.toHaveProperty('results')
  })
})

describe('createCollectionRuntime', () => {
  it('starts empty: nothing run, nothing selected', () => {
    expect(createCollectionRuntime()).toEqual({
      results: [], hasRun: false, isRunning: false, runError: null, runErrorCode: null,
      runId: null, startedAt: null, cancelled: false,
      total: null, totalFilter: null, isCounting: false, countShown: false,
      explainResult: null, explainStorage: null, explainError: null, explainRunning: false, explainVerbosity: null,
      selectedRow: -1, selectedRows: [], selectedField: null, elapsedMs: null,
    })
  })

  it('is a fresh object each time, so two tabs never share results', () => {
    const a = createCollectionRuntime()
    const b = createCollectionRuntime()
    a.results.push({ _id: 1 })
    expect(b.results).toEqual([])
  })
})

describe('migrateCollectionState', () => {
  it('reads the flat saved record every session on disk still holds', () => {
    const state = migrateCollectionState({
      filter: '{ a: 1 }', projection: '{ a: 1 }', sort: '{ a: -1 }',
      skip: 10, limit: 25, pipeline: '[]', vqb: { conditions: [] }, colOrder: ['a'],
    })
    expect(state.v).toBe(COLLECTION_STATE_VERSION)
    expect(state.query).toMatchObject({
      filter: '{ a: 1 }', projection: '{ a: 1 }', sort: '{ a: -1 }', skip: 10, limit: 25,
    })
  })

  it('fills what an older record never held', () => {
    const state = migrateCollectionState({ filter: '{}' })
    expect(state.query.limit).toBe(50)
    expect(state.query.pipeline).toBe('')
    expect(state.query.vqb).toBe(null)
  })

  it('takes a current-version state back verbatim', () => {
    const made = createCollectionState()
    made.query.filter = '{ x: 1 }'
    expect(migrateCollectionState({ state: made })).toBe(made)
  })

  it('starts fresh rather than misreading a state from a newer app', () => {
    const future = { ...createCollectionState(), v: COLLECTION_STATE_VERSION + 1 }
    future.query = { ...future.query, filter: '{ from: "the future" }' }
    expect(migrateCollectionState({ state: future }).query.filter).toBe('')
  })

  it('survives a record with nothing in it', () => {
    expect(migrateCollectionState().query.filter).toBe('')
    expect(migrateCollectionState({}).query.skip).toBe(0)
  })
})
