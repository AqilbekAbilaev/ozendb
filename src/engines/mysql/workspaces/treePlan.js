// EXPLAIN ANALYZE's tree, the text MySQL 8.0.18 – 8.2 gives, read into steps of the
// second JSON version's shape for planRows: each an `operation` with its `inputs` and,
// once it ran, `actual_rows`, `actual_loops` and `actual_last_row_ms`, each per loop.
// A line indented four spaces further feeds the one above it. A heading with no
// figures of its own, such as `Hash`, is folded into the steps under it, as the JSON
// version keeps it on them; a step that `(never executed)` has no figures.

const LINE = /^(?<indent> *)-> (?<operation>.*?)(?<cost> {2}\(cost=[^)]*\))?(?: {1,2}\((?:actual time=[^ ]+?\.\.(?<ms>[^ ]+) rows=(?<rows>[^ ]+) loops=(?<loops>\d+)|(?<never>never executed))\))?$/

const number = (text) => (text == null ? null : Number(text))

export function treeSteps(text) {
  const roots = []
  const into = [roots]
  for (const line of text.split('\n')) {
    const found = LINE.exec(line)?.groups
    if (!found) continue
    const depth = found.indent.length / 4
    const heading = !found.cost && !found.ms && !found.never
    const step = {
      operation: found.operation, inputs: [],
      actual_rows: number(found.rows), actual_loops: number(found.loops), actual_last_row_ms: number(found.ms),
    }
    if (!heading) into[depth].push(step)
    into[depth + 1] = heading ? into[depth] : step.inputs
  }
  return roots
}
