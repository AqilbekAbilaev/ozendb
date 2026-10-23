import { classicSteps } from './classicPlan.js'

// An EXPLAIN FORMAT=JSON plan, in its second version or the classic one, as rows to draw
// (the shape SqlPlan.vue reads, as PostgreSQL's planRows makes it): each step depth-first
// with the table behind its alias, and `hot` on the step whose own share, excluding its
// inputs', is largest. An analyzed plan sizes each step by its time over all its loops;
// one MySQL didn't run, by its estimated cost, against the costliest step, as a plan's
// root can carry no cost of its own. A plan can have more than one root: the classic
// format puts a select-list subquery beside its query.
export function planRows(plan) {
  const [roots, estimated] = plan.query_block ? [classicSteps(plan), true] : [[plan], plan.actual_last_row_ms == null]
  const weight = (node) => (estimated ? node.estimated_total_cost ?? 0 : (node.actual_last_row_ms ?? 0) * (node.actual_loops ?? 1))
  const twoPlaces = (value) => (value == null ? null : Math.round(value * 100) / 100)
  const rows = []
  const walk = (node, depth) => {
    const inputs = node.inputs ?? []
    rows.push({
      depth,
      node: node.operation,
      detail: node.alias && node.table_name !== node.alias ? node.table_name : '',
      rows: twoPlaces(estimated ? node.estimated_rows : node.actual_rows),
      ms: estimated ? null : weight(node),
      weight: weight(node),
      own: weight(node) - inputs.reduce((sum, input) => sum + weight(input), 0),
      hot: false,
    })
    inputs.forEach(input => walk(input, depth + 1))
  }
  roots.forEach(root => walk(root, 0))
  const largest = Math.max(...rows.map(r => r.weight))
  for (const row of rows) row.share = largest ? row.weight / largest : 0
  rows.reduce((a, b) => (b.own > a.own ? b : a)).hot = true
  return { rows, planningMs: null, executionMs: estimated ? null : roots.reduce((sum, root) => sum + weight(root), 0), estimated }
}
