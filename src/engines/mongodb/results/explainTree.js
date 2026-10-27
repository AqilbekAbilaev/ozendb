// Pure module (no Vue) that normalizes a MongoDB explain document into a
// render-ready tree for the Visual Explain graph (see ExplainGraph.vue). Handles the
// three shapes we can lay out — a `find` plan, an `aggregate` pipeline, and a graceful
// notice for sharded plans — plus a bottleneck-severity pass.
//
// Orientation mirrors Studio 3T: the synthetic **Result** node is the OUTPUT and
// sits at the root (leftmost when drawn); execution stages hang off it as children,
// with the data source (COLLSCAN / IXSCAN / $cursor scan) as the deepest descendant.
//
// We prefer `executionStats.executionStages` because it carries runtime numbers
// (nReturned, time, docs/keys examined). When only `queryPlanner.winningPlan` is
// present (verbosity below executionStats), we fall back to it for structure and
// leave the counts/timings null.

// Friendly label per stage. Unmapped stages fall back to the raw stage string.
// Aggregation stages are keyed with their leading `$` (e.g. `$group`).
const STAGE_LABELS = {
  COLLSCAN:           'Collection scan',
  IXSCAN:             'Index scan',
  FETCH:              'Fetch',
  SORT:               'Sort',
  SORT_KEY_GENERATOR: 'Sort key generator',
  SORT_MERGE:         'Sort merge',
  LIMIT:              'Limit',
  SKIP:               'Skip',
  PROJECTION_SIMPLE:  'Projection',
  PROJECTION_COVERED: 'Projection',
  PROJECTION_DEFAULT: 'Projection',
  OR:                 'Or',
  AND_SORTED:         'And (sorted)',
  AND_HASH:           'And (hash)',
  SUBPLAN:            'Subplan',
  COUNT:              'Count',
  COUNT_SCAN:         'Count scan',
  DISTINCT_SCAN:      'Distinct scan',
  TEXT:               'Text',
  GEO_NEAR_2D:        'Geo near (2d)',
  GEO_NEAR_2DSPHERE:  'Geo near (2dsphere)',
  SHARD_MERGE:        'Shard merge',
  GROUP:              'Group',
  SHARDED:            'Sharded plan',
  // Aggregation pipeline stages.
  $cursor:            'Cursor',
  $match:             'Match',
  $group:             'Group',
  $sort:              'Sort',
  $project:           'Project',
  $unwind:            'Unwind',
  $limit:             'Limit',
  $skip:              'Skip',
  $lookup:            'Lookup',
  $facet:             'Facet',
  $addFields:         'Add fields',
  $set:               'Set',
  $sample:            'Sample',
  $graphLookup:       'Graph lookup',
  $bucket:            'Bucket',
  $bucketAuto:        'Bucket (auto)',
  $unionWith:         'Union with',
  $count:             'Count',
  $replaceRoot:       'Replace root',
  $replaceWith:       'Replace with',
  $sortByCount:       'Sort by count',
}

export function labelForStage(stage) {
  if (!stage) return 'Stage'
  return STAGE_LABELS[stage] || stage
}

// A number or null — explain nodes sometimes omit a field entirely.
function numOrNull(value) {
  return value === undefined || value === null ? null : value
}

// Best-effort memory usage in bytes for a stage, from whichever field the server
// happened to report it under (SORT stages use `memUsage` /
// `totalDataSizeSortedBytesEstimate`, GROUP uses `maxUsedMemBytes`). Null when none
// is present or the value isn't a number.
function memBytesFor(node) {
  const candidates = [
    node.memUsage,
    node.totalDataSizeSortedBytesEstimate,
    node.maxUsedMemBytes,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'number') return candidate
  }
  return null
}

// Recursively normalize one plan/executionStages node and its input stage(s).
// Both `inputStage` (single object) and `inputStages` (array — OR / SORT_MERGE /
// AND_*) are walked so branching plans keep all their arms.
function normalizeStage(node) {
  if (!node || typeof node !== 'object') return null

  const children = []
  if (node.inputStage) {
    const child = normalizeStage(node.inputStage)
    if (child) children.push(child)
  }
  if (Array.isArray(node.inputStages)) {
    for (const input of node.inputStages) {
      const child = normalizeStage(input)
      if (child) children.push(child)
    }
  }

  const stageNode = {
    stage:        node.stage || null,
    label:        labelForStage(node.stage),
    timeMs:       numOrNull(node.executionTimeMillisEstimate),
    nReturned:    numOrNull(node.nReturned),
    docsExamined: numOrNull(node.docsExamined),
    keysExamined: numOrNull(node.keysExamined),
    works:        numOrNull(node.works),
    indexName:    node.indexName || null,
    memBytes:     memBytesFor(node),
    children:     children,
  }

  // Residual predicate: MongoDB attaches a `filter` to a scan/FETCH stage for the part
  // of the query it can't satisfy with the index alone. Studio 3T shows it as its own
  // Filter node sitting between the stage and its consumer, so wrap the stage in one.
  // A `$match` stage (aggregate) is a real pipeline stage, not a residual — never wrap it.
  const filter = node.filter
  const isRealFilter =
    filter &&
    typeof filter === 'object' &&
    !Array.isArray(filter) &&
    Object.keys(filter).length > 0 &&
    stageNode.stage !== '$match'
  if (!isRealFilter) return stageNode

  const full = JSON.stringify(filter)
  const predicate = full.length > 60 ? full.slice(0, 59) + '…' : full
  return {
    stage:         'FILTER',
    label:         'Filter',
    predicate:     predicate,
    predicateFull: full,
    isFilter:      true,
    nReturned:     stageNode.nReturned,
    timeMs:        null,
    docsExamined:  null,
    keysExamined:  null,
    works:         null,
    indexName:     null,
    memBytes:      null,
    children:      [stageNode],
    severity:      null,
  }
}

// The one operator key (`$group`, …) of a pipeline-stage document, skipping the
// sibling runtime fields (nReturned, executionTimeMillisEstimate). Null if none.
function stageKeyOf(stageDoc) {
  for (const key of Object.keys(stageDoc)) {
    if (key.startsWith('$')) return key
  }
  return null
}

// Normalize one aggregation pipeline stage element. The `$cursor` stage embeds a
// `find` sub-plan (the initial scan/fetch), which we recurse through the existing
// normalizeStage so the scan becomes the deepest chained node beneath it.
function normalizeAggStage(stageDoc) {
  const key = stageKeyOf(stageDoc)
  const node = {
    stage:        key,
    label:        labelForStage(key),
    timeMs:       numOrNull(stageDoc.executionTimeMillisEstimate),
    nReturned:    numOrNull(stageDoc.nReturned),
    docsExamined: null,
    keysExamined: null,
    works:        null,
    indexName:    null,
    memBytes:     memBytesFor(stageDoc),
    children:     [],
  }
  if (key === '$cursor') {
    const cursor = stageDoc.$cursor || {}
    const stats = cursor.executionStats || null
    const planner = cursor.queryPlanner || null
    const planRoot =
      (stats && stats.executionStages) ||
      (planner && planner.winningPlan) ||
      null
    const sub = normalizeStage(planRoot)
    if (sub) node.children.push(sub)
    // Fall back to the cursor's own runtime numbers when the stage element omitted them.
    if (node.nReturned === null && stats) node.nReturned = numOrNull(stats.nReturned)
    if (node.timeMs === null && stats) node.timeMs = numOrNull(stats.executionTimeMillis)
    if (node.docsExamined === null && stats) node.docsExamined = numOrNull(stats.totalDocsExamined)
    if (node.keysExamined === null && stats) node.keysExamined = numOrNull(stats.totalKeysExamined)
  }
  return node
}

// Build the tree for an aggregation explain (`explainDoc.stages` is an array in
// execution order). We chain the stages in REVERSE execution order: the last stage's
// output is nearest Result; the `$cursor`/scan is the deepest node.
function buildAggregateTree(explainDoc) {
  const stages = explainDoc.stages
  if (!Array.isArray(stages) || stages.length === 0) return null

  const nodes = stages.map((stage) => normalizeAggStage(stage))
  // Hang each stage as the child of the one that runs after it, so execution order
  // reversed becomes Result → last stage → … → $cursor → scan.
  for (let i = 1; i < nodes.length; i++) {
    nodes[i].children.push(nodes[i - 1])
  }
  const topNode = nodes[nodes.length - 1]

  // Pipeline totals, when the server reported them, otherwise the final stage's output.
  const stats = explainDoc.executionStats || null
  return {
    stage:        'RESULT',
    label:        'Result',
    isResult:     true,
    timeMs:       stats ? numOrNull(stats.executionTimeMillis) : numOrNull(topNode.timeMs),
    nReturned:    stats ? numOrNull(stats.nReturned) : numOrNull(topNode.nReturned),
    docsExamined: stats ? numOrNull(stats.totalDocsExamined) : null,
    keysExamined: stats ? numOrNull(stats.totalKeysExamined) : null,
    works:        null,
    indexName:    null,
    memBytes:     null,
    children:     [topNode],
  }
}

// A synthetic target leaf: the Collection or Index the plan reads from, with its
// on-disk byte size. Studio 3T draws these as the deepest nodes with a size edge label.
function makeTargetNode(stage, label, targetName, bytes) {
  return {
    stage:        stage,
    label:        label,
    targetName:   targetName || null,
    bytes:        bytes === undefined ? null : bytes,
    isTarget:     true,
    timeMs:       null,
    nReturned:    null,
    docsExamined: null,
    keysExamined: null,
    works:        null,
    indexName:    null,
    memBytes:     null,
    children:     [],
    severity:     null,
  }
}

// Walk a normalized find tree and hang a Collection/Index target leaf off each data
// source: COLLECTION under FETCH/COLLSCAN (data size), INDEX under IXSCAN (index size).
// Find-only — aggregate/sharded trees never get these. Recurses over the pre-existing
// children first so the freshly appended targets aren't visited again.
function augmentStorage(node, storage, namespace) {
  if (!node) return
  for (const child of node.children || []) augmentStorage(child, storage, namespace)
  if (node.stage === 'FETCH' || node.stage === 'COLLSCAN') {
    node.children.push(makeTargetNode('COLLECTION', 'Collection', namespace, storage.dataSize))
  } else if (node.stage === 'IXSCAN') {
    const targetName = namespace ? namespace + '.' + node.indexName : node.indexName
    const sizes = storage.indexSizes || {}
    const bytes =
      node.indexName != null && sizes[node.indexName] != null ? sizes[node.indexName] : null
    node.children.push(makeTargetNode('INDEX', 'Index', targetName, bytes))
  }
}

// Build the tree for a `find` explain (executionStages preferred, winningPlan fallback).
// When `storage` is supplied, target leaves (Collection/Index with sizes) are appended.
function buildFindTree(explainDoc, storage) {
  const stats = explainDoc.executionStats || null
  const planner = explainDoc.queryPlanner || null

  const planRoot =
    (stats && stats.executionStages) ||
    (planner && planner.winningPlan) ||
    null

  const topStage = normalizeStage(planRoot)
  if (!topStage) return null

  if (storage) {
    const namespace = (planner && planner.namespace) || null
    augmentStorage(topStage, storage, namespace)
  }

  return {
    stage:        'RESULT',
    label:        'Result',
    isResult:     true,
    // Top-level totals live on the Result node (folds in the old summary chips).
    timeMs:       stats ? numOrNull(stats.executionTimeMillis) : null,
    nReturned:    stats ? numOrNull(stats.nReturned) : null,
    docsExamined: stats ? numOrNull(stats.totalDocsExamined) : null,
    keysExamined: stats ? numOrNull(stats.totalKeysExamined) : null,
    works:        null,
    indexName:    null,
    memBytes:     null,
    children:     [topStage],
  }
}

// A minimal notice tree for sharded plans, whose per-shard structure we don't lay out.
// The graph shows the single SHARDED node with its note; raw JSON stays available.
function buildShardedNotice() {
  return {
    stage:        'RESULT',
    label:        'Result',
    isResult:     true,
    timeMs:       null,
    nReturned:    null,
    docsExamined: null,
    keysExamined: null,
    works:        null,
    indexName:    null,
    memBytes:     null,
    children: [{
      stage:        'SHARDED',
      label:        'Sharded plan',
      note:         'View JSON for per-shard detail',
      timeMs:       null,
      nReturned:    null,
      docsExamined: null,
      keysExamined: null,
      works:        null,
      indexName:    null,
      memBytes:     null,
      children:     [],
    }],
  }
}

// Self-time of a node = its own executionTimeMillisEstimate minus the time already
// counted for its direct children (the server's estimate is CUMULATIVE — a parent
// includes its children's time). Clamped to >= 0; null when the node has no timing.
function selfTime(node) {
  if (node.timeMs === null || node.timeMs === undefined) return null
  let childSum = 0
  for (const child of node.children || []) {
    if (child.timeMs !== null && child.timeMs !== undefined) childSum += child.timeMs
  }
  const self = node.timeMs - childSum
  return self < 0 ? 0 : self
}

// Bottleneck heuristic. Walks the tree once and tags each node with a `severity`:
//   'warn' — a collection scan (COLLSCAN): no index used at that point.
//   'hot'  — the node with the greatest SELF-time when that dominates the plan (>= 50%
//            of the Result total, and the total is above a small floor so near-zero
//            plans aren't flagged); OR a scan/FETCH node with poor selectivity (examines
//            >= 100 docs and >= 10x what it returns).
//   null   — otherwise.
// Self-time (not raw cumulative time) is used so a pass-through parent like LIMIT — which
// inherits its child's time — isn't falsely flagged. Synthetic Result / Filter / target
// nodes do no measurable work and are excluded. 'hot' takes precedence over 'warn'.
export function annotateSeverity(root) {
  if (!root) return root

  const all = []
  const collect = (node) => {
    all.push(node)
    for (const child of node.children || []) collect(child)
  }
  collect(root)

  for (const node of all) node.severity = null

  const measurable = (node) => !node.isResult && !node.isFilter && !node.isTarget

  const totalTime = root.timeMs
  // Greatest self-time among measurable nodes (for the dominating-time rule).
  let maxSelfNode = null
  let maxSelf = 0
  for (const node of all) {
    if (!measurable(node)) continue
    const self = selfTime(node)
    if (self === null) continue
    if (maxSelfNode === null || self > maxSelf) {
      maxSelfNode = node
      maxSelf = self
    }
  }

  const HOT_MIN_TOTAL_MS = 5 // floor so tiny/near-zero plans aren't flagged as hot

  for (const node of all) {
    if (!measurable(node)) continue
    if (node.stage === 'COLLSCAN') node.severity = 'warn'
    // Poor selectivity on a scan / fetch → hot (overrides the COLLSCAN warn above).
    const scanLike =
      node.stage === 'COLLSCAN' || node.stage === 'IXSCAN' || node.stage === 'FETCH'
    if (scanLike && node.docsExamined !== null && node.docsExamined !== undefined) {
      const returned = node.nReturned || 1
      if (node.docsExamined >= 100 && node.docsExamined >= 10 * returned) {
        node.severity = 'hot'
      }
    }
  }

  // Dominating self-time node → hot. Only meaningful with real (non-trivial) timings.
  if (maxSelfNode && typeof totalTime === 'number' && totalTime >= HOT_MIN_TOTAL_MS) {
    if (maxSelf >= 0.5 * totalTime) maxSelfNode.severity = 'hot'
  }

  return root
}

// Build the render-ready tree from a raw explain document. Detects the shape
// (sharded / aggregate / find), builds the matching tree, then runs the severity
// pass. `storage` (find-only, from collection_stats) adds Collection/Index target
// leaves with byte sizes. Returns null when the document has no recognizable plan.
export function buildExplainTree(explainDoc, storage) {
  if (!explainDoc || typeof explainDoc !== 'object') return null

  const root = explainDoc.shards || explainDoc.splitPipeline
    ? buildShardedNotice()
    : Array.isArray(explainDoc.stages)
      ? buildAggregateTree(explainDoc)
      : buildFindTree(explainDoc, storage || null)
  if (!root) return null

  return annotateSeverity(root)
}
