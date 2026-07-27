<script setup>
// Visual Explain node-graph. Renders the parsed explain tree (see
// utils/explainTree.js) as an inline-SVG graph, Studio-3T style: the Result box on
// the left, execution stages flowing in from the right, the data source (COLLSCAN /
// IXSCAN) as the deepest node. All parsing lives in the util — this component only
// lays out and draws the already-normalized tree.
import { computed } from 'vue'
import BaseIcon from '../base/BaseIcon.vue'
import { fmtBytes } from '../../utils/format'

const props = defineProps({
  // The render-ready tree from buildExplainTree(), or null.
  tree: { type: Object, default: null },
})

// ── layout constants ──────────────────────────────────
const NODE_W = 200
const NODE_H = 90
const COL_GAP = 74 // horizontal gap between depth columns
const ROW_GAP = 26 // vertical gap between stacked rows
const PAD = 22

// Stage → icon. Reuses existing glyphs where one fits; the ex* glyphs are dedicated.
const STAGE_ICONS = {
  RESULT:             'exResult',
  COLLSCAN:           'exScan',
  IXSCAN:             'exIndex',
  FILTER:             'filter',
  COLLECTION:         'collSmall',
  INDEX:              'exIndex',
  COUNT_SCAN:         'exIndex',
  DISTINCT_SCAN:      'exIndex',
  FETCH:              'exFetch',
  SORT:               'exSort',
  SORT_MERGE:         'exSort',
  SORT_KEY_GENERATOR: 'exSort',
  LIMIT:              'filter',
  SKIP:               'filter',
  PROJECTION_SIMPLE:  'collSmall',
  PROJECTION_COVERED: 'collSmall',
  PROJECTION_DEFAULT: 'collSmall',
  OR:                 'aggregate',
  SORT_MERGE_OR:      'aggregate',
  SHARDED:            'exShard',
  // Aggregation pipeline stages.
  $cursor:            'exFetch',
  $match:             'filter',
  $limit:             'filter',
  $skip:              'filter',
  $sort:              'exSort',
  $sortByCount:       'exSort',
  $group:             'exGroup',
  $bucket:            'exGroup',
  $bucketAuto:        'exGroup',
  $count:             'count',
  $project:           'exProject',
  $addFields:         'exProject',
  $set:               'exProject',
  $replaceRoot:       'exProject',
  $replaceWith:       'exProject',
  $unwind:            'exUnwind',
  $lookup:            'exLookup',
  $graphLookup:       'exLookup',
  $facet:             'aggregate',
  $unionWith:         'aggregate',
  $sample:            'aggregate',
}

function iconFor(node) {
  if (node.isResult) return 'exResult'
  return STAGE_ICONS[node.stage] || 'cog'
}

// Edge label: byte size for an edge feeding a Collection/Index target (3T shows
// "90.3 MiB"), the child's doc count ("N docs") otherwise. Null hides the label.
function edgeLabel(edge) {
  if (edge.to.isTarget) return fmtBytes(edge.to.bytes, null)
  const count = fmtCount(edge.docs)
  return count === null ? null : `${count} docs`
}

function nodeTitle(node) {
  if (node.stage === 'IXSCAN' && node.indexName) return `${node.label} · ${node.indexName}`
  return node.label
}

// ms → "0.2s" like the 3T screenshot; sub-100ms stays in ms so we don't round tiny
// timings to a misleading "0.0s". "—" when the timing is unknown (planner fallback).
function fmtTime(ms) {
  if (ms === null || ms === undefined) return '—'
  if (ms >= 100) return `${(ms / 1000).toFixed(1)}s`
  return `${ms} ms`
}

function fmtCount(n) {
  if (n === null || n === undefined) return null
  return n.toLocaleString()
}

// bytes → "90.3 MiB" / "119.4 KiB" / "640 B" (binary, base-1024, to match Studio 3T's
// edge labels). Null when unknown (hides the line).

// keysExamined → "1,204 keys". Null when unknown.
function fmtKeys(n) {
  if (n === null || n === undefined) return null
  return `${n.toLocaleString()} keys`
}

// ── layout ────────────────────────────────────────────
// Tidy-tree pass: column = depth from Result (grows rightward); leaves each take the
// next free row, internal nodes center over their children. A linear chain therefore
// draws as one straight row; a branch (multiple inputStages) fans its arms onto
// separate rows and the parent sits centered between them.
const layout = computed(() => {
  const root = props.tree
  if (!root) return null

  const nodes = []
  const edges = []
  let nextRow = 0
  let maxCol = 0

  function place(node, col) {
    const children = node.children || []
    let row
    let placedChildren = []
    if (children.length === 0) {
      row = nextRow
      nextRow += 1
    } else {
      placedChildren = children.map((child) => place(child, col + 1))
      const first = placedChildren[0].row
      const last = placedChildren[placedChildren.length - 1].row
      row = (first + last) / 2
    }
    maxCol = Math.max(maxCol, col)
    const placed = {
      id: nodes.length,
      stage: node.stage,
      label: node.label,
      isResult: !!node.isResult,
      isFilter: !!node.isFilter,
      isTarget: !!node.isTarget,
      predicate: node.predicate || null,
      predicateFull: node.predicateFull || null,
      targetName: node.targetName || null,
      bytes: node.bytes === undefined ? null : node.bytes,
      indexName: node.indexName,
      timeMs: node.timeMs,
      nReturned: node.nReturned,
      docsExamined: node.docsExamined,
      keysExamined: node.keysExamined,
      memBytes: node.memBytes,
      severity: node.severity || null,
      note: node.note || null,
      col: col,
      row: row,
      x: PAD + col * (NODE_W + COL_GAP),
      y: PAD + row * (NODE_H + ROW_GAP),
    }
    nodes.push(placed)
    // Edge from this node (output, left) to each child (source, right). Docs flow
    // from the child into the parent, so the edge is labelled with the child's
    // nReturned and its arrowhead points back toward the parent.
    for (const child of placedChildren) {
      edges.push({ from: placed, to: child, docs: child.nReturned })
    }
    return placed
  }

  place(root, 0)

  let width = 0
  let height = 0
  for (const node of nodes) {
    width = Math.max(width, node.x + NODE_W)
    height = Math.max(height, node.y + NODE_H)
  }

  return {
    nodes: nodes,
    edges: edges,
    width: width + PAD,
    height: height + PAD,
  }
})

// Cubic edge path from the child's left edge to the parent's right edge (drawn in
// flow direction so marker-end lands the arrow on the parent).
function edgePath(edge) {
  const x1 = edge.to.x
  const y1 = edge.to.y + NODE_H / 2
  const x2 = edge.from.x + NODE_W
  const y2 = edge.from.y + NODE_H / 2
  const mx = (x1 + x2) / 2
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
}

function edgeLabelPos(edge) {
  const x1 = edge.to.x
  const y1 = edge.to.y + NODE_H / 2
  const x2 = edge.from.x + NODE_W
  const y2 = edge.from.y + NODE_H / 2
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 7 }
}
</script>

<template>
  <div class="explain-graph">
    <div v-if="!layout" class="eg-empty">No plan to display.</div>
    <template v-else>
    <div class="eg-legend">
      <span class="eg-leg-item"><span class="eg-leg-dot hot"></span> Bottleneck</span>
      <span class="eg-leg-item"><span class="eg-leg-dot warn"></span> No index</span>
    </div>
    <div class="eg-canvas">
    <svg
      class="eg-svg"
      :width="layout.width"
      :height="layout.height"
      :viewBox="`0 0 ${layout.width} ${layout.height}`"
    >
      <defs>
        <marker
          id="eg-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0 L10 5 L0 10 z" class="eg-arrow-head" />
        </marker>
      </defs>

      <!-- edges first so nodes paint over them -->
      <g class="eg-edges">
        <template v-for="edge in layout.edges" :key="`e${edge.from.id}-${edge.to.id}`">
          <path :d="edgePath(edge)" class="eg-edge" marker-end="url(#eg-arrow)" />
          <text
            v-if="edgeLabel(edge) !== null"
            class="eg-edge-label"
            :x="edgeLabelPos(edge).x"
            :y="edgeLabelPos(edge).y"
            text-anchor="middle"
          >{{ edgeLabel(edge) }}</text>
        </template>
      </g>

      <!-- nodes -->
      <g class="eg-nodes">
        <foreignObject
          v-for="node in layout.nodes"
          :key="`n${node.id}`"
          :x="node.x"
          :y="node.y"
          :width="NODE_W"
          :height="NODE_H"
        >
          <div
            xmlns="http://www.w3.org/1999/xhtml"
            class="eg-node"
            :class="{ 'is-result': node.isResult, 'is-filter': node.isFilter, 'is-target': node.isTarget, 'sev-hot': node.severity === 'hot', 'sev-warn': node.severity === 'warn' }"
          >
            <div class="eg-node-head">
              <span class="eg-node-icon"><BaseIcon :name="iconFor(node)" :size="15" /></span>
              <span class="eg-node-title" :title="nodeTitle(node)">{{ nodeTitle(node) }}</span>
            </div>

            <!-- Residual filter: the predicate as a monospace subtitle, no timing/metrics. -->
            <div v-if="node.isFilter" class="eg-node-pred" :title="node.predicateFull">{{ node.predicate }}</div>

            <!-- Collection / Index target: namespace + byte size, no timing/metrics. -->
            <template v-else-if="node.isTarget">
              <div v-if="node.targetName" class="eg-node-pred" :title="node.targetName">{{ node.targetName }}</div>
              <div v-if="fmtBytes(node.bytes, null) !== null" class="eg-node-meta eg-node-meta2">
                <span class="eg-node-ret">{{ fmtBytes(node.bytes, null) }}</span>
              </div>
            </template>

            <template v-else>
              <div class="eg-node-meta">
                <span class="eg-node-time"><BaseIcon name="clock" :size="11" /> {{ fmtTime(node.timeMs) }}</span>
                <span v-if="node.isResult && fmtCount(node.nReturned) !== null" class="eg-node-ret">
                  {{ fmtCount(node.nReturned) }} returned
                </span>
                <span v-else-if="!node.isResult && fmtCount(node.docsExamined) !== null" class="eg-node-ret">
                  {{ fmtCount(node.docsExamined) }} examined
                </span>
              </div>
              <div
                v-if="fmtKeys(node.keysExamined) !== null || fmtBytes(node.memBytes, null) !== null"
                class="eg-node-meta eg-node-meta2"
              >
                <span v-if="fmtKeys(node.keysExamined) !== null" class="eg-node-ret">{{ fmtKeys(node.keysExamined) }}</span>
                <span v-if="fmtBytes(node.memBytes, null) !== null" class="eg-node-ret">{{ fmtBytes(node.memBytes, null) }}</span>
              </div>
              <div v-if="node.note" class="eg-node-note">{{ node.note }}</div>
            </template>
          </div>
        </foreignObject>
      </g>
    </svg>
    </div>
    </template>
  </div>
</template>

<style scoped>
.explain-graph {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.eg-legend {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-soft);
  font-size: 11px;
  color: var(--text-dim);
  flex: 0 0 auto;
}
.eg-leg-item { display: inline-flex; align-items: center; gap: 6px; }
.eg-leg-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.eg-leg-dot.hot  { background: var(--danger); }
.eg-leg-dot.warn { background: var(--warn); }
.eg-canvas {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}
.eg-empty {
  padding: 32px;
  color: var(--text-faint);
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.eg-svg { display: block; }

.eg-edge {
  fill: none;
  stroke: var(--border-soft);
  stroke-width: 1.6px;
}
.eg-arrow-head { fill: var(--text-faint); }
.eg-edge-label {
  font-family: var(--mono);
  font-size: 10.5px;
  fill: var(--text-dim);
  /* halo so the label stays legible where it crosses the edge */
  paint-order: stroke;
  stroke: var(--bg-panel);
  stroke-width: 3px;
  stroke-linejoin: round;
}

/* nodes are HTML inside <foreignObject> */
.eg-node {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  font-family: system-ui, sans-serif;
}
.eg-node.is-result {
  border-color: var(--accent);
  background: var(--bg-panel-2);
}
/* Target (Collection / Index) nodes: a filled secondary surface with a dashed
   border — distinct from execution stages, but still clearly legible (a dashed
   --border line on a transparent node reads as near-invisible in dark mode). */
.eg-node.is-target {
  border-style: dashed;
  border-color: var(--border-soft);
  background: var(--bg-panel-2);
}
.eg-node.is-target .eg-node-title { color: var(--text); font-weight: 600; }
.eg-node.is-target .eg-node-icon { color: var(--text-dim); }
.eg-node.is-target .eg-node-ret { color: var(--text-dim); font-size: 11px; }
/* Residual predicate / target namespace subtitle. */
.eg-node-pred {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Bottleneck highlighting: a colored left-stripe (inset shadow) + border. */
.eg-node.sev-hot {
  border-color: var(--danger);
  box-shadow: inset 4px 0 0 var(--danger);
}
.eg-node.sev-warn {
  border-color: var(--warn);
  box-shadow: inset 4px 0 0 var(--warn);
}
.eg-node-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.eg-node-icon {
  display: flex;
  align-items: center;
  color: var(--accent);
  flex: 0 0 auto;
}
.is-result .eg-node-icon { color: var(--accent); }
.eg-node-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.eg-node-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--text-dim);
}
.eg-node-meta2 { font-size: 10.5px; }
.eg-node-note {
  font-size: 10.5px;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.eg-node-time {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--green);
}
.eg-node-ret {
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
