#!/usr/bin/env node
// Hard ceiling on source file length (see AGENTS.md → Code quality → File size).

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const LIMIT = 500
const SOFT = 400

// git ls-files keeps us to real sources — no node_modules, no target/, no generated code.
// `--others --exclude-standard` adds files that exist but aren't staged yet: without it a
// brand-new god file passes locally right up until it's committed, which is exactly the
// moment you want to hear about it.
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '*.js', '*.vue', '*.rs'],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean)

// Tests are exempt. A spec grows with the number of cases it covers, and a limit that
// counts them pushes toward fewer cases — the opposite of what this repo wants. Covers
// the `.test.js`/`.test.rs` sidecars, the `mod tests` files pulled in by path, and the
// fixture modules that exist only to feed them.
function isTest(file) {
  return /\.test\.|\.fixtures\./.test(file) || /(^|\/)(tests|integration_tests)\.rs$/.test(file)
}

const problems = []
const warnings = []

for (const file of files) {
  if (isTest(file)) continue
  // Every line counts, a .vue template included. What you have to scroll through to
  // follow the thing is the honest measure, and a template long enough to blow the
  // limit is asking for subcomponents just as much as a long script is.
  // Count newlines so the numbers agree with `wc -l`, which is what anyone will reach
  // for when they want to check this by hand.
  const lines = readFileSync(file, 'utf8').split('\n').length - 1
  if (lines > LIMIT) {
    problems.push(`${file}: ${lines} lines, limit is ${LIMIT} — split it before this lands.`)
  } else if (lines > SOFT) {
    warnings.push(`${file}: ${lines} lines, past the ${SOFT}-line soft limit — justify it in review.`)
  }
}

if (warnings.length) {
  console.warn(`Past the soft limit (${warnings.length}):\n`)
  for (const w of warnings) console.warn(`  ${w}`)
  console.warn('')
}

if (problems.length) {
  console.error(`File size check failed (${problems.length}):\n`)
  for (const p of problems) console.error(`  ${p}`)
  console.error('')
  process.exit(1)
}

console.log(`File size check passed — ${files.length} files, limit ${LIMIT} (soft ${SOFT}).`)
