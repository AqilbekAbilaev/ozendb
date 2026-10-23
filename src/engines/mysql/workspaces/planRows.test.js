import { describe, it, expect } from 'vitest'
import { planRows } from './planRows.js'
import { analyzedPlan, estimatedPlan } from './planRows.fixtures.js'

describe('planRows of an analyzed plan', () => {
  const { rows, planningMs, executionMs, estimated } = planRows(analyzedPlan)

  it('lists every step depth-first, each under the one it feeds', () => {
    expect(rows.map(r => [r.depth, r.node])).toEqual([
      [0, 'Sort: `COUNT(*)` DESC'],
      [1, 'Table scan on <temporary>'],
      [2, 'Aggregate using temporary table'],
      [3, 'Nested loop inner join'],
      [4, 'Hash semijoin (pets.owner_id = o.id)'],
      [5, 'Covering index scan on o using by_name'],
      [5, "Filter: (pets.kind = 'cat')"],
      [6, 'Table scan on pets'],
      [4, 'Covering index lookup on p using by_owner (owner_id=o.id)'],
    ])
  })

  it('names the table behind an alias', () => {
    expect(rows[5].detail).toBe('owners')
    expect(rows[7].detail).toBe('')
    expect(rows[0].detail).toBe('')
  })

  it('times each step over all its loops, sizes its bar against the whole query, and marks the slowest', () => {
    expect(rows[0].ms).toBe(4.150384)
    expect(rows[0].share).toBe(1)
    expect(rows[8].ms).toBeCloseTo(0.037113)
    expect(rows[8].rows).toBe(1.5)
    expect(rows.filter(r => r.hot).map(r => r.node)).toEqual(['Aggregate using temporary table'])
  })

  it('carries the execution time, MySQL giving no planning time', () => {
    expect([planningMs, executionMs, estimated]).toEqual([null, 4.150384, false])
  })
})

describe('planRows of a plan MySQL did not run', () => {
  const { rows, executionMs, estimated } = planRows(estimatedPlan)

  it('shows the estimated rows, no times, and sizes each bar by its cost against the costliest', () => {
    expect(estimated).toBe(true)
    expect(executionMs).toBe(null)
    expect(rows.map(r => r.ms)).toEqual([null, null, null, null])
    expect(rows[2].rows).toBe(1)
    expect(rows[3].rows).toBe(1.33)
    expect(rows[1].share).toBe(1)
    expect(rows[3].share).toBeCloseTo(0.4667 / 0.8167, 3)
    expect(rows.filter(r => r.hot).map(r => r.node)).toEqual(['Index lookup on p using by_owner (owner_id=o.id)'])
  })
})
