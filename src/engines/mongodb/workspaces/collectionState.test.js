import { describe, it, expect } from 'vitest'
import {
  COLLECTION_STATE_VERSION, createCollectionState, createCollectionUi,
  createCollectionRuntime, migrateCollectionState, withFlatFields,
} from './collectionState'

const tab = () => withFlatFields({
  state: createCollectionState(), ui: createCollectionUi(), runtime: createCollectionRuntime(),
})

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
      results: [], hasRun: false, isRunning: false, runError: null,
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

describe('withFlatFields', () => {
  it('reads a query field through its old flat name', () => {
    const t = tab()
    t.state.query.filter = '{ a: 1 }'
    expect(t.filter).toBe('{ a: 1 }')
  })

  it('writes through the flat name into the nested state', () => {
    const t = tab()
    t.filter = '{ b: 2 }'
    t.skip = 30
    expect(t.state.query).toMatchObject({ filter: '{ b: 2 }', skip: 30 })
  })

  it('does the same for runtime fields', () => {
    const t = tab()
    t.results = [{ _id: 1 }]
    t.isRunning = true
    expect(t.runtime.results).toEqual([{ _id: 1 }])
    expect(t.runtime.isRunning).toBe(true)
    expect(t.results).toEqual([{ _id: 1 }])
  })

  it('and for the per-device view fields', () => {
    const t = tab()
    t.resultView = 'json'
    expect(t.ui.resultView).toBe('json')
  })

  it('stays spreadable: the flat names survive Object.keys and a spread', () => {
    // 26 files still spread a tab or walk its keys; the split must not change that.
    const t = tab()
    t.filter = '{ a: 1 }'
    expect(Object.keys(t)).toContain('filter')
    expect({ ...t }.filter).toBe('{ a: 1 }')
  })

  it('holds the nested state as the one place the value lives', () => {
    const t = tab()
    t.filter = '{ a: 1 }'
    expect(JSON.parse(JSON.stringify(t)).state.query.filter).toBe('{ a: 1 }')
  })

  it('can be applied twice, as a clone then a hydrate does', () => {
    const t = withFlatFields(withFlatFields({
      state: createCollectionState(), ui: createCollectionUi(), runtime: createCollectionRuntime(),
    }))
    t.filter = '{ a: 1 }'
    expect(t.state.query.filter).toBe('{ a: 1 }')
  })

  it('leaves an object with no state alone rather than defining broken accessors', () => {
    const plain = withFlatFields({ kind: 'shell', code: 'db.x.find()' })
    expect(plain.filter).toBeUndefined()
    expect(plain.code).toBe('db.x.find()')
  })

  it('round-trips: a state saved and restored holds what was built', () => {
    const t = tab()
    t.filter = '{ a: 1 }'
    t.limit = 25
    t.results = [{ _id: 1 }]   // runtime: deliberately not saved

    const saved = JSON.parse(JSON.stringify({ state: t.state, ui: t.ui }))
    const restored = withFlatFields({
      state: migrateCollectionState(saved),
      ui: { ...createCollectionUi(), ...saved.ui },
      runtime: createCollectionRuntime(),
    })
    expect(restored.filter).toBe('{ a: 1 }')
    expect(restored.limit).toBe(25)
    expect(restored.results).toEqual([])
  })
})
