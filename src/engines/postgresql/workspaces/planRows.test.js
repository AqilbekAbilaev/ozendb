import { describe, it, expect } from 'vitest'
import { planRows } from './planRows.js'
import { joinPlan } from './planRows.fixtures.js'

describe('planRows', () => {
  const { rows, planningMs, executionMs } = planRows(joinPlan)

  it('lists every node depth-first, each under its parent', () => {
    expect(rows.map(r => [r.depth, r.node])).toEqual([
      [0, 'Sort'], [1, 'Aggregate'], [2, 'Hash Join'], [3, 'Seq Scan'], [3, 'Hash'], [4, 'Seq Scan'],
    ])
  })

  it('names what each node works on', () => {
    expect(rows[3].detail).toBe('b')
    expect(rows[5].detail).toBe('a')
    expect(rows[0].detail).toMatch(/count/)
  })

  it('times each node, sizes its bar against the whole query, and marks the slowest step', () => {
    expect(rows[0].ms).toBe(0.116)
    expect(rows[0].share).toBe(1)
    expect(rows[3].share).toBeCloseTo(0.018 / 0.116)
    expect(rows[3].rows).toBe(200)
    expect(rows.filter(r => r.hot).map(r => r.node)).toEqual(['Hash Join'])
  })

  it('carries the planning and execution times', () => {
    expect([planningMs, executionMs]).toEqual([0.582, 0.204])
  })

  it('counts a node\'s time over all its loops', () => {
    const plan = [{ Plan: { 'Node Type': 'Nested Loop', 'Actual Total Time': 2, 'Actual Loops': 1, 'Actual Rows': 5, Plans: [
      { 'Node Type': 'Index Scan', 'Index Name': 'b_pkey', 'Relation Name': 'b', 'Actual Total Time': 0.1, 'Actual Loops': 10, 'Actual Rows': 1 },
    ] } }]
    const [, inner] = planRows(plan).rows
    expect(inner.ms).toBeCloseTo(1)
    expect(inner.detail).toBe('b using b_pkey')
  })
})
