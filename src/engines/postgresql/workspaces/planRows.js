// An EXPLAIN (ANALYZE, FORMAT JSON) plan as rows to draw: each node depth-first with
// what it works on, its time over all its loops, that time as a share of the whole
// query (the bar), and `hot` on the node whose own time — excluding its children's —
// is largest, the step to look at first.
export function planRows([{ Plan: root, 'Planning Time': planningMs, 'Execution Time': executionMs }]) {
  const total = (node) => node['Actual Total Time'] * (node['Actual Loops'] ?? 1)
  const rows = []
  const walk = (node, depth) => {
    const ms = total(node)
    const children = node.Plans ?? []
    rows.push({
      depth,
      node: node['Node Type'],
      detail: detailOf(node),
      rows: node['Actual Rows'],
      ms,
      share: total(root) ? ms / total(root) : 0,
      own: ms - children.reduce((sum, child) => sum + total(child), 0),
      hot: false,
    })
    children.forEach(child => walk(child, depth + 1))
  }
  walk(root, 0)
  const hottest = rows.reduce((a, b) => (b.own > a.own ? b : a))
  hottest.hot = true
  return { rows, planningMs, executionMs }
}

function detailOf(node) {
  if (node['Index Name']) return `${node['Relation Name'] ?? ''} using ${node['Index Name']}`.trim()
  if (node['Relation Name']) return node['Relation Name']
  if (node['Sort Key']) return node['Sort Key'].join(', ')
  return node['Hash Cond'] ?? node['Join Filter'] ?? node['Filter'] ?? ''
}
