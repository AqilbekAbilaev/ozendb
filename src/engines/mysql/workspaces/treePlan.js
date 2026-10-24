// EXPLAIN ANALYZE's tree, the text MySQL 8.0.18 – 8.2 gives, read into steps of the
// second JSON version's shape for planRows: each an `operation` with its `inputs` and,
// once it ran, `actual_rows`, `actual_loops` and `actual_last_row_ms`, each per loop.
// A step feeds the nearest one above it indented less, and a line that doesn't start
// with `->` carries on the step above it, broken by a line break in what it names. A
// heading with no figures of its own, such as `Hash`, is folded into the steps under
// it, as the JSON version keeps it on them; one with nothing under it is a step. A step
// that `(never executed)` has no figures.

const STEP = /^(?<indent> *)-> (?<text>.*)$/s

// A step's figures, each group known by its first words; text in any other parentheses
// stays in what the step names.
const FIGURES = / {1,2}\((cost=[^)]*|actual time=[^)]*|never executed)\)/g

// The figure `key` gives in `group`, the last of a range such as `time=0.1..0.2`.
function figure(group, key) {
  const value = Number(new RegExp(`${key}=(?:\\S+?\\.\\.)?(\\S+)`).exec(group)?.[1] ?? NaN)
  return Number.isNaN(value) ? null : value
}

export function treeSteps(text) {
  const roots = []
  const above = []
  const headings = new Set()
  for (const line of lines(text)) {
    const found = STEP.exec(line)?.groups
    if (!found) continue
    const groups = [...found.text.matchAll(FIGURES)].map(([, group]) => group)
    const actual = groups.find(group => group.startsWith('actual')) ?? ''
    const step = {
      operation: found.text.replace(FIGURES, '').trim(), inputs: [],
      actual_rows: figure(actual, 'rows'), actual_loops: figure(actual, 'loops'), actual_last_row_ms: figure(actual, 'time'),
    }
    if (!groups.length) headings.add(step)
    while (above.length && above.at(-1).indent >= found.indent.length) above.pop()
    const feeds = above.at(-1)?.step.inputs ?? roots
    feeds.push(step)
    above.push({ indent: found.indent.length, step })
  }
  return folded(roots, headings)
}

// Each step's text, its lines carried on joined back to it.
function lines(text) {
  const steps = []
  for (const line of text.trimEnd().split('\n')) {
    if (/^ *-> /.test(line) || !steps.length) steps.push(line)
    else steps[steps.length - 1] += `\n${line}`
  }
  return steps
}

function folded(steps, headings) {
  return steps.flatMap((step) => {
    step.inputs = folded(step.inputs, headings)
    return headings.has(step) && step.inputs.length ? step.inputs : [step]
  })
}
