import { describe, it, expect } from 'vitest'
import { planRows } from './planRows.js'
import { analyzedPlan, estimatedPlan, classicJoin, classicUnion, classicDerived, classicSubqueries, classicDelete,
  treeJoin, treeUnion, treeDerived, treeSubquery, treeNeverExecuted, treeImpossibleWhere,
  treeBrokenLines } from './planRows.fixtures.js'

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

describe('planRows of a plan in the classic format', () => {
  const steps = (plan) => planRows(plan).rows.map(r => [r.depth, r.node])
  const pets = 'Filter: ((`explain probe`.`pets`.`owner_id` = `explain probe`.`o`.`id`) and (`explain probe`.`pets`.`kind` = \'cat\'))'

  it('lists the sort, the grouping and the join around the tables they read', () => {
    expect(steps(classicJoin)).toEqual([
      [0, 'Sort'],
      [1, 'Aggregate using temporary table'],
      [2, 'Nested loop join'],
      [3, 'Covering index scan on o using by_name'],
      [3, pets],
      [4, 'Table scan on pets'],
      [3, 'Covering index lookup on p using by_owner'],
    ])
  })

  it('is always estimated: MySQL ran nothing', () => {
    const { rows, executionMs, estimated } = planRows(classicJoin)
    expect([estimated, executionMs]).toEqual([true, null])
    expect(rows.map(r => r.ms)).toEqual(Array(7).fill(null))
  })

  it('reads each table\'s rows per scan, and a filter\'s as the share of them it keeps', () => {
    const { rows } = planRows(classicJoin)
    expect(rows.map(r => r.rows)).toEqual([null, null, null, 3, 1, 4, 1])
  })

  it('costs each table by its own reading and each step by its inputs, marking the costliest table', () => {
    const { rows } = planRows(classicJoin)
    expect(rows[0].share).toBe(1)
    expect(rows[6].share).toBeCloseTo(1.15 / 2.55, 5)
    expect(rows.filter(r => r.hot).map(r => r.node)).toEqual(['Covering index lookup on p using by_owner'])
  })

  it('shows a union as its two halves', () => {
    expect(steps(classicUnion)).toEqual([
      [0, 'Union materialize with deduplication'],
      [1, 'Covering index scan on owners using by_name'],
      [1, 'Table scan on pets'],
    ])
  })

  it('reads a derived table from what it was materialized from, and adds the sort\'s own cost', () => {
    expect(steps(classicDerived)).toEqual([
      [0, 'Sort'],
      [1, 'Table scan on d'],
      [2, 'Materialize'],
      [3, 'Group aggregate'],
      [4, 'Covering index scan on pets using by_owner'],
    ])
    expect(planRows(classicDerived).rows.filter(r => r.hot).map(r => r.node)).toEqual(['Sort'])
  })

  it('puts a select-list subquery beside the query, and a WHERE subquery under its filter', () => {
    expect(steps(classicSubqueries)).toEqual([
      [0, 'Filter: (`explain probe`.`o`.`id` > (/* select#3 */ select min(`explain probe`.`pets`.`id`) from `explain probe`.`pets`))'],
      [1, 'Covering index scan on o using by_name'],
      [1, 'Select #3 (subquery)'],
      [2, 'Select tables optimized away'],
      [0, 'Select #2 (subquery, dependent)'],
      [1, 'Covering index lookup on p using by_owner'],
    ])
  })

  it('shows a single-table DELETE above the read that finds its rows', () => {
    expect(steps(classicDelete)).toEqual([
      [0, 'Delete from pets'],
      [1, 'Filter: (`explain probe`.`pets`.`owner_id` = 1)'],
      [2, 'Index range scan on pets using by_owner'],
    ])
  })
})

describe('planRows of EXPLAIN ANALYZE\'s tree', () => {
  const steps = (plan) => planRows(plan).rows.map(r => [r.depth, r.node])

  it('lists the same steps the second JSON version does, a heading such as Hash folded into the step under it', () => {
    expect(steps(treeJoin)).toEqual(steps(analyzedPlan))
  })

  it('times each step over all its loops, sizes its bar against the whole query, and marks the slowest', () => {
    const { rows, planningMs, executionMs, estimated } = planRows(treeJoin)
    expect([planningMs, executionMs, estimated]).toEqual([null, 0.156, false])
    expect(rows[0].share).toBe(1)
    expect(rows[8].ms).toBeCloseTo(0.0148, 6)
    expect(rows[8].rows).toBe(1.5)
    expect(rows.filter(r => r.hot).map(r => r.node)).toEqual(['Aggregate using temporary table'])
  })

  it('leaves a step that never ran without rows or a time', () => {
    expect(planRows(treeNeverExecuted).rows[2]).toMatchObject({ node: 'Index lookup on p using by_owner (owner_id=o.id)', rows: null, ms: null })
  })

  it('puts a select-list subquery beside its query, and counts both in the execution time', () => {
    const { executionMs } = planRows(treeSubquery)
    expect(steps(treeSubquery)).toEqual([
      [0, 'Covering index scan on o using by_name'],
      [0, 'Aggregate: count(0)'],
      [1, 'Covering index lookup on p using by_owner (owner_id=o.id)'],
    ])
    expect(executionMs).toBeCloseTo(0.0409 + 0.0133 * 3, 6)
  })

  it('keeps a step that runs over more than one line whole, with its line breaks', () => {
    expect(steps(treeBrokenLines)).toEqual([
      [0, "Filter: ((cap.`o\nx`.`name` > <cache>(convert(concat('a','\\n') using utf8mb4))) and (cap.`o\nx`.id > 1))"],
      [1, 'Covering index scan on o\nx using by_name'],
    ])
    expect(planRows(treeBrokenLines).rows[1].ms).toBe(0.0147)
  })

  it('puts a step indented more than one level deeper under the nearest step above it', () => {
    const tree = '-> Limit: 1 row(s)  (actual time=0.2..0.3 rows=1 loops=1)\n            -> Table scan on Straße  (actual time=0.1..0.2 rows=1 loops=1)'
    expect(steps(tree)).toEqual([[0, 'Limit: 1 row(s)'], [1, 'Table scan on Straße']])
  })

  it('nests by indentation that is not in steps of four, and never fails on it', () => {
    const tree = [
      '-> Sort: d.n  (actual time=0.5..0.6 rows=3 loops=1)',
      '  -> Filter: (d.n > 1)  (actual time=0.4..0.5 rows=3 loops=1)',
      '         -> Table scan on d  (actual time=0.1..0.2 rows=3 loops=1)',
      '     -> Materialize  (actual time=0.1..0.2 rows=3 loops=1)',
      ' -> Table scan on e  (actual time=0.1..0.2 rows=3 loops=1)',
    ].join('\n')
    expect(steps(tree)).toEqual([[0, 'Sort: d.n'], [1, 'Filter: (d.n > 1)'], [2, 'Table scan on d'], [2, 'Materialize'], [1, 'Table scan on e']])
  })

  it('reads rows written with an exponent', () => {
    const tree = '-> Table scan on `big table`  (cost=101000 rows=1e+06) (actual time=0.05..250 rows=1e+06 loops=1)'
    expect(planRows(tree).rows[0]).toMatchObject({ node: 'Table scan on `big table`', rows: 1000000, ms: 250 })
  })

  it('reads a time given as one figure rather than a range', () => {
    expect(planRows('-> Table scan on t  (actual time=0.2 rows=3 loops=2)').rows[0]).toMatchObject({ node: 'Table scan on t', rows: 3, ms: 0.4 })
  })

  it('keeps a step with only a cost as a step, without a time', () => {
    const tree = '-> Limit: 1 row(s)  (cost=0.35..0.35 rows=1)\n    -> Table scan on t  (actual time=0.1..0.2 rows=1 loops=1)'
    expect(steps(tree)).toEqual([[0, 'Limit: 1 row(s)'], [1, 'Table scan on t']])
    expect(planRows(tree).rows[0].ms).toBe(null)
  })

  it('keeps text it does not know after the figures in what the step names, and the step itself', () => {
    const tree = '-> Sort: ü  (cost=1 rows=2) (actual time=0.1..0.2 rows=2 loops=1) (using filesort)\n    -> Table scan on t  (actual time=0.1..0.2 rows=2 loops=1)'
    expect(steps(tree)).toEqual([[0, 'Sort: ü (using filesort)'], [1, 'Table scan on t']])
    expect(planRows(tree).rows[0].ms).toBe(0.2)
  })

  it('keeps a step whose figures it cannot read, without them', () => {
    expect(planRows('-> Table scan on t  (actual time=? rows=? loops=?)').rows[0]).toMatchObject({ node: 'Table scan on t', rows: null, ms: null })
  })

  it('nests a union\'s halves and a derived table\'s source under what reads them', () => {
    expect(steps(treeUnion)).toEqual([
      [0, 'Table scan on <union temporary>'],
      [1, 'Union materialize with deduplication'],
      [2, 'Covering index scan on owners using by_name'],
      [2, 'Table scan on pets'],
    ])
    expect(steps(treeDerived).map(([depth]) => depth)).toEqual([0, 1, 2, 3, 4])
  })
})

describe('planRows of a plan with no steps, or only one', () => {
  it('draws no rows for a tree with no steps in it, rather than failing', () => {
    expect(planRows('')).toEqual({ rows: [], planningMs: null, executionMs: 0, estimated: false })
  })

  it('draws no rows for a classic plan whose query block names nothing it knows', () => {
    expect(planRows({ query_block: { select_id: 1 } }).rows).toEqual([])
  })

  it('shows a WHERE that can never hold as the one step it is', () => {
    expect(planRows(treeImpossibleWhere).rows).toMatchObject([{ depth: 0, node: 'Zero rows (Impossible WHERE)', rows: 0, ms: 0.000076, share: 1, hot: true }])
  })

  it('keeps a line with no figures and nothing under it as a step of its own', () => {
    expect(planRows('-> Zero rows (Impossible WHERE)').rows).toMatchObject([{ depth: 0, node: 'Zero rows (Impossible WHERE)', rows: null, ms: null }])
  })
})
