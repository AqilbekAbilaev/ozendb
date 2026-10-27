import { describe, it, expect } from 'vitest'
import { buildExplainTree, labelForStage, annotateSeverity } from './explainTree'

// Realistic (trimmed) find-explain documents. Shapes match what the Rust
// `explain_query` command returns with executionStats verbosity.

// Simple full-collection scan.
const collscanDoc = {
  queryPlanner: {
    winningPlan: { stage: 'COLLSCAN', direction: 'forward' },
  },
  executionStats: {
    nReturned: 5,
    executionTimeMillis: 3,
    totalKeysExamined: 0,
    totalDocsExamined: 200,
    executionStages: {
      stage: 'COLLSCAN',
      nReturned: 5,
      executionTimeMillisEstimate: 2,
      works: 202,
      docsExamined: 200,
    },
  },
}

// IXSCAN feeding a FETCH — the classic indexed lookup.
const ixscanFetchDoc = {
  queryPlanner: {
    winningPlan: {
      stage: 'FETCH',
      inputStage: {
        stage: 'IXSCAN',
        indexName: 'name_1',
        keyPattern: { name: 1 },
      },
    },
  },
  executionStats: {
    nReturned: 2,
    executionTimeMillis: 1,
    totalKeysExamined: 2,
    totalDocsExamined: 2,
    executionStages: {
      stage: 'FETCH',
      nReturned: 2,
      executionTimeMillisEstimate: 1,
      works: 3,
      docsExamined: 2,
      inputStage: {
        stage: 'IXSCAN',
        nReturned: 2,
        executionTimeMillisEstimate: 0,
        works: 3,
        keysExamined: 2,
        indexName: 'name_1',
      },
    },
  },
}

// Branching plan: FETCH ← OR ← two IXSCANs.
const orBranchDoc = {
  executionStats: {
    nReturned: 4,
    executionTimeMillis: 2,
    totalKeysExamined: 5,
    totalDocsExamined: 4,
    executionStages: {
      stage: 'FETCH',
      nReturned: 4,
      executionTimeMillisEstimate: 2,
      docsExamined: 4,
      inputStage: {
        stage: 'OR',
        nReturned: 4,
        executionTimeMillisEstimate: 1,
        inputStages: [
          { stage: 'IXSCAN', nReturned: 2, keysExamined: 2, indexName: 'a_1' },
          { stage: 'IXSCAN', nReturned: 2, keysExamined: 3, indexName: 'b_1' },
        ],
      },
    },
  },
}

// Structure only — no executionStats (lower verbosity fallback).
const plannerOnlyDoc = {
  queryPlanner: {
    winningPlan: {
      stage: 'SORT',
      inputStage: {
        stage: 'COLLSCAN',
        direction: 'forward',
      },
    },
  },
}

// Aggregate explain: stages array (execution order) with a $cursor sub-plan, a
// $group (memory via maxUsedMemBytes), and a $sort (memory via sorted-bytes estimate).
const aggregateDoc = {
  stages: [
    {
      $cursor: {
        queryPlanner: { winningPlan: { stage: 'COLLSCAN' } },
        executionStats: {
          nReturned: 100,
          executionTimeMillis: 4,
          totalDocsExamined: 100,
          totalKeysExamined: 0,
          executionStages: {
            stage: 'COLLSCAN',
            nReturned: 100,
            executionTimeMillisEstimate: 3,
            docsExamined: 100,
          },
        },
      },
      nReturned: 100,
      executionTimeMillisEstimate: 3,
    },
    {
      $group: { _id: '$cat', total: { $sum: 1 } },
      nReturned: 5,
      executionTimeMillisEstimate: 2,
      maxUsedMemBytes: 2200000,
    },
    {
      $sort: { total: -1 },
      nReturned: 5,
      executionTimeMillisEstimate: 1,
      totalDataSizeSortedBytesEstimate: 1048576,
    },
  ],
}

// Find explain whose SORT stage reports memory usage.
const sortMemDoc = {
  executionStats: {
    nReturned: 10,
    executionTimeMillis: 5,
    totalKeysExamined: 0,
    totalDocsExamined: 50,
    executionStages: {
      stage: 'SORT',
      nReturned: 10,
      executionTimeMillisEstimate: 4,
      memUsage: 3145728,
      totalDataSizeSortedBytesEstimate: 3000000,
      inputStage: { stage: 'COLLSCAN', nReturned: 50, docsExamined: 50 },
    },
  },
}

// COLLSCAN with good selectivity and a trivial timing → warn (no index) but not hot.
const goodCollscanDoc = {
  executionStats: {
    nReturned: 40,
    executionTimeMillis: 2,
    totalKeysExamined: 0,
    totalDocsExamined: 50,
    executionStages: {
      stage: 'COLLSCAN',
      nReturned: 40,
      executionTimeMillisEstimate: 1,
      docsExamined: 50,
    },
  },
}

// Indexed plan whose FETCH time dominates the total (>= 50%) → that node is hot.
const slowFetchDoc = {
  executionStats: {
    nReturned: 5,
    executionTimeMillis: 10,
    totalKeysExamined: 5,
    totalDocsExamined: 5,
    executionStages: {
      stage: 'FETCH',
      nReturned: 5,
      executionTimeMillisEstimate: 8,
      docsExamined: 5,
      inputStage: {
        stage: 'IXSCAN',
        nReturned: 5,
        executionTimeMillisEstimate: 1,
        keysExamined: 5,
        indexName: 'x_1',
      },
    },
  },
}

// Sharded find explain: per-shard sub-structures we don't lay out.
const shardedDoc = {
  queryPlanner: { winningPlan: { stage: 'SHARD_MERGE' } },
  shards: { shard0000: { executionStages: { stage: 'COLLSCAN' } } },
}

// FETCH carrying a residual predicate (filter) over an IXSCAN → a Filter node wraps it.
const residualFilterDoc = {
  queryPlanner: { namespace: 'shop.orders' },
  executionStats: {
    nReturned: 3,
    executionTimeMillis: 2,
    totalKeysExamined: 8,
    totalDocsExamined: 8,
    executionStages: {
      stage: 'FETCH',
      filter: { status: 'active' },
      nReturned: 3,
      executionTimeMillisEstimate: 2,
      docsExamined: 8,
      inputStage: {
        stage: 'IXSCAN',
        nReturned: 8,
        executionTimeMillisEstimate: 0,
        keysExamined: 8,
        indexName: 'ts_1',
      },
    },
  },
}

// Same plan but an empty filter object → no Filter node.
const emptyFilterDoc = {
  executionStats: {
    nReturned: 3,
    executionTimeMillis: 2,
    totalDocsExamined: 3,
    executionStages: {
      stage: 'FETCH',
      filter: {},
      nReturned: 3,
      executionTimeMillisEstimate: 1,
      docsExamined: 3,
      inputStage: { stage: 'IXSCAN', nReturned: 3, keysExamined: 3, indexName: 'ts_1' },
    },
  },
}

// Linear chain LIMIT ← FETCH ← IXSCAN with cumulative timings: LIMIT inherits FETCH's
// time (self-time ~0) so it must NOT be flagged as the bottleneck.
const limitPassthroughDoc = {
  executionStats: {
    nReturned: 20,
    executionTimeMillis: 13,
    totalKeysExamined: 500,
    totalDocsExamined: 500,
    executionStages: {
      stage: 'LIMIT',
      nReturned: 20,
      executionTimeMillisEstimate: 8,
      inputStage: {
        stage: 'FETCH',
        nReturned: 20,
        executionTimeMillisEstimate: 8,
        docsExamined: 500,
        inputStage: {
          stage: 'IXSCAN',
          nReturned: 500,
          executionTimeMillisEstimate: 0,
          keysExamined: 500,
          indexName: 'ts_1',
        },
      },
    },
  },
}

describe('labelForStage', () => {
  it('maps known stages to friendly names', () => {
    expect(labelForStage('COLLSCAN')).toBe('Collection scan')
    expect(labelForStage('IXSCAN')).toBe('Index scan')
    expect(labelForStage('PROJECTION_COVERED')).toBe('Projection')
    expect(labelForStage('SORT_MERGE')).toBe('Sort merge')
  })
  it('maps aggregation stage keys to friendly names', () => {
    expect(labelForStage('$group')).toBe('Group')
    expect(labelForStage('$lookup')).toBe('Lookup')
    expect(labelForStage('$unwind')).toBe('Unwind')
  })
  it('falls back to the raw stage string when unmapped', () => {
    expect(labelForStage('MYSTERY_STAGE')).toBe('MYSTERY_STAGE')
    expect(labelForStage('$mysteryStage')).toBe('$mysteryStage')
  })
})

describe('buildExplainTree', () => {
  it('returns null for a non-plan document', () => {
    expect(buildExplainTree(null)).toBeNull()
    expect(buildExplainTree({})).toBeNull()
    expect(buildExplainTree('nope')).toBeNull()
  })

  it('builds a Result root carrying top-level totals', () => {
    const root = buildExplainTree(collscanDoc)
    expect(root.isResult).toBe(true)
    expect(root.label).toBe('Result')
    expect(root.nReturned).toBe(5)
    expect(root.timeMs).toBe(3)
    expect(root.docsExamined).toBe(200)
    expect(root.keysExamined).toBe(0)
    expect(root.children).toHaveLength(1)
  })

  it('parses a COLLSCAN plan with runtime counts from executionStages', () => {
    const root = buildExplainTree(collscanDoc)
    const scan = root.children[0]
    expect(scan.stage).toBe('COLLSCAN')
    expect(scan.label).toBe('Collection scan')
    expect(scan.nReturned).toBe(5)
    expect(scan.timeMs).toBe(2)
    expect(scan.docsExamined).toBe(200)
    expect(scan.children).toHaveLength(0)
  })

  it('parses IXSCAN→FETCH with index name and nesting', () => {
    const root = buildExplainTree(ixscanFetchDoc)
    const fetch = root.children[0]
    expect(fetch.stage).toBe('FETCH')
    expect(fetch.children).toHaveLength(1)
    const ixscan = fetch.children[0]
    expect(ixscan.stage).toBe('IXSCAN')
    expect(ixscan.label).toBe('Index scan')
    expect(ixscan.indexName).toBe('name_1')
    expect(ixscan.keysExamined).toBe(2)
    expect(ixscan.children).toHaveLength(0)
  })

  it('walks inputStages arrays for branching plans', () => {
    const root = buildExplainTree(orBranchDoc)
    const fetch = root.children[0]
    const or = fetch.children[0]
    expect(or.stage).toBe('OR')
    expect(or.children).toHaveLength(2)
    expect(or.children.map((c) => c.indexName)).toEqual(['a_1', 'b_1'])
    expect(or.children.map((c) => c.stage)).toEqual(['IXSCAN', 'IXSCAN'])
  })

  it('falls back to winningPlan structure with null counts when no executionStats', () => {
    const root = buildExplainTree(plannerOnlyDoc)
    expect(root.isResult).toBe(true)
    expect(root.nReturned).toBeNull()
    expect(root.timeMs).toBeNull()
    const sort = root.children[0]
    expect(sort.stage).toBe('SORT')
    expect(sort.timeMs).toBeNull()
    expect(sort.nReturned).toBeNull()
    const scan = sort.children[0]
    expect(scan.stage).toBe('COLLSCAN')
    expect(scan.children).toHaveLength(0)
  })
})

describe('buildExplainTree — aggregate', () => {
  it('chains pipeline stages in reverse execution order under Result', () => {
    const root = buildExplainTree(aggregateDoc)
    expect(root.isResult).toBe(true)
    // Last stage ($sort) is nearest Result; $cursor/scan is deepest.
    const sort = root.children[0]
    expect(sort.stage).toBe('$sort')
    const group = sort.children[0]
    expect(group.stage).toBe('$group')
    const cursor = group.children[0]
    expect(cursor.stage).toBe('$cursor')
    const scan = cursor.children[0]
    expect(scan.stage).toBe('COLLSCAN')
    expect(scan.children).toHaveLength(0)
  })

  it('carries the final stage output as the Result totals', () => {
    const root = buildExplainTree(aggregateDoc)
    expect(root.nReturned).toBe(5)
  })

  it('parses stage memory from maxUsedMemBytes and sorted-bytes estimate', () => {
    const root = buildExplainTree(aggregateDoc)
    const sort = root.children[0]
    const group = sort.children[0]
    expect(sort.memBytes).toBe(1048576)
    expect(group.memBytes).toBe(2200000)
  })
})

describe('buildExplainTree — memory on a find SORT stage', () => {
  it('reads memUsage as the SORT stage memBytes', () => {
    const root = buildExplainTree(sortMemDoc)
    const sort = root.children[0]
    expect(sort.stage).toBe('SORT')
    expect(sort.memBytes).toBe(3145728)
  })
})

describe('annotateSeverity', () => {
  it('flags a COLLSCAN with good selectivity as warn, not hot', () => {
    const root = buildExplainTree(goodCollscanDoc)
    const scan = root.children[0]
    expect(scan.stage).toBe('COLLSCAN')
    expect(scan.severity).toBe('warn')
  })

  it('flags a dominating-time stage as hot', () => {
    const root = buildExplainTree(slowFetchDoc)
    const fetch = root.children[0]
    expect(fetch.stage).toBe('FETCH')
    expect(fetch.severity).toBe('hot')
    // The fast IXSCAN below it is not flagged.
    expect(fetch.children[0].severity).toBeNull()
  })

  it('leaves a fast, well-indexed tiny plan unflagged', () => {
    const root = buildExplainTree(ixscanFetchDoc)
    const fetch = root.children[0]
    expect(fetch.severity).toBeNull()
    expect(fetch.children[0].severity).toBeNull()
  })

  it('never flags hot when timings are null (planner-only verbosity)', () => {
    const root = buildExplainTree(plannerOnlyDoc)
    const severities = []
    const walk = (n) => { severities.push(n.severity); (n.children || []).forEach(walk) }
    walk(root)
    expect(severities).not.toContain('hot')
  })

  it('is a no-op on a null tree', () => {
    expect(annotateSeverity(null)).toBeNull()
  })
})

describe('buildExplainTree — residual filter', () => {
  it('wraps a stage carrying a non-empty filter in a Filter node', () => {
    const root = buildExplainTree(residualFilterDoc)
    const filter = root.children[0]
    expect(filter.stage).toBe('FILTER')
    expect(filter.isFilter).toBe(true)
    expect(filter.predicate).toBe(JSON.stringify({ status: 'active' }))
    // The Filter's output count mirrors the wrapped stage's nReturned.
    expect(filter.nReturned).toBe(3)
    expect(filter.timeMs).toBeNull()
    // The wrapped FETCH sits beneath the Filter, IXSCAN below that.
    const fetch = filter.children[0]
    expect(fetch.stage).toBe('FETCH')
    expect(fetch.children[0].stage).toBe('IXSCAN')
  })

  it('does not wrap a stage whose filter is empty', () => {
    const root = buildExplainTree(emptyFilterDoc)
    const fetch = root.children[0]
    expect(fetch.stage).toBe('FETCH')
    expect(fetch.children[0].stage).toBe('IXSCAN')
  })

  it('truncates a long predicate to ~60 chars with an ellipsis, keeping the full string', () => {
    const longFilter = { description: 'x'.repeat(120) }
    const doc = {
      executionStats: {
        nReturned: 1,
        executionTimeMillis: 1,
        executionStages: {
          stage: 'COLLSCAN',
          filter: longFilter,
          nReturned: 1,
          executionTimeMillisEstimate: 1,
          docsExamined: 1,
        },
      },
    }
    const filter = buildExplainTree(doc).children[0]
    expect(filter.stage).toBe('FILTER')
    expect(filter.predicate.length).toBeLessThanOrEqual(60)
    expect(filter.predicate.endsWith('…')).toBe(true)
    expect(filter.predicateFull).toBe(JSON.stringify(longFilter))
  })
})

describe('buildExplainTree — storage target nodes', () => {
  const storage = { dataSize: 94700000, indexSizes: { name_1: 122300 } }

  it('appends Collection under FETCH and Index under IXSCAN with sizes', () => {
    const root = buildExplainTree(ixscanFetchDoc, storage)
    const fetch = root.children[0]
    expect(fetch.stage).toBe('FETCH')
    // FETCH now has two children: its IXSCAN input plus the Collection target.
    const stages = fetch.children.map((c) => c.stage)
    expect(stages).toContain('IXSCAN')
    expect(stages).toContain('COLLECTION')
    const collection = fetch.children.find((c) => c.stage === 'COLLECTION')
    expect(collection.isTarget).toBe(true)
    expect(collection.bytes).toBe(94700000)
    const ixscan = fetch.children.find((c) => c.stage === 'IXSCAN')
    const index = ixscan.children.find((c) => c.stage === 'INDEX')
    expect(index.isTarget).toBe(true)
    expect(index.bytes).toBe(122300)
    expect(index.targetName).toBe('name_1')
  })

  it('uses the queryPlanner namespace in target names when present', () => {
    const doc = { ...ixscanFetchDoc, queryPlanner: { ...ixscanFetchDoc.queryPlanner, namespace: 'db.coll' } }
    const root = buildExplainTree(doc, storage)
    const fetch = root.children[0]
    const collection = fetch.children.find((c) => c.stage === 'COLLECTION')
    expect(collection.targetName).toBe('db.coll')
    const ixscan = fetch.children.find((c) => c.stage === 'IXSCAN')
    const index = ixscan.children.find((c) => c.stage === 'INDEX')
    expect(index.targetName).toBe('db.coll.name_1')
  })

  it('leaves index bytes null when the index size is unknown', () => {
    const root = buildExplainTree(ixscanFetchDoc, { dataSize: 100, indexSizes: {} })
    const ixscan = root.children[0].children.find((c) => c.stage === 'IXSCAN')
    const index = ixscan.children.find((c) => c.stage === 'INDEX')
    expect(index.bytes).toBeNull()
  })

  it('adds no target nodes when no storage is passed', () => {
    const root = buildExplainTree(ixscanFetchDoc)
    const fetch = root.children[0]
    expect(fetch.children.map((c) => c.stage)).toEqual(['IXSCAN'])
    expect(fetch.children[0].children).toHaveLength(0)
  })

  it('never adds target nodes to aggregate trees', () => {
    const root = buildExplainTree(aggregateDoc, storage)
    const walk = (n) => [n, ...(n.children || []).flatMap(walk)]
    expect(walk(root).some((n) => n.isTarget)).toBe(false)
  })

  it('never adds target nodes to sharded trees', () => {
    const root = buildExplainTree(shardedDoc, storage)
    const walk = (n) => [n, ...(n.children || []).flatMap(walk)]
    expect(walk(root).some((n) => n.isTarget)).toBe(false)
  })
})

describe('annotateSeverity — self-time (cumulative-time fix)', () => {
  it('does not flag a pass-through LIMIT that only inherits its child time', () => {
    const root = buildExplainTree(limitPassthroughDoc)
    const limit = root.children[0]
    expect(limit.stage).toBe('LIMIT')
    expect(limit.severity).not.toBe('hot')
    // The FETCH below it carries the real self-time / poor selectivity → flagged.
    const fetch = limit.children[0]
    expect(fetch.stage).toBe('FETCH')
    expect(fetch.severity).toBe('hot')
  })

  it('ignores synthetic target nodes when picking the bottleneck', () => {
    const root = buildExplainTree(slowFetchDoc, { dataSize: 999, indexSizes: { x_1: 1 } })
    const walk = (n) => [n, ...(n.children || []).flatMap(walk)]
    const targets = walk(root).filter((n) => n.isTarget)
    expect(targets.length).toBeGreaterThan(0)
    for (const t of targets) expect(t.severity).toBeNull()
  })
})

describe('buildExplainTree — sharded', () => {
  it('returns a graceful notice instead of throwing', () => {
    expect(() => buildExplainTree(shardedDoc)).not.toThrow()
    const root = buildExplainTree(shardedDoc)
    expect(root.isResult).toBe(true)
    const notice = root.children[0]
    expect(notice.stage).toBe('SHARDED')
    expect(notice.note).toBeTruthy()
    expect(notice.children).toHaveLength(0)
  })

  it('treats a split aggregation pipeline as sharded too', () => {
    const root = buildExplainTree({ splitPipeline: { shardsPart: [], mergerPart: [] } })
    expect(root.children[0].stage).toBe('SHARDED')
  })
})
