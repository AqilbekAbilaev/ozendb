#!/usr/bin/env node
// Hard ceiling on source file length (see AGENTS.md → Code quality → File size).

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const LIMIT = 600

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

const problems = []

for (const file of files) {
  // Count newlines so the numbers agree with `wc -l`, which is what anyone will reach
  // for when they want to check this by hand.
  const lines = readFileSync(file, 'utf8').split('\n').length - 1
  if (lines > LIMIT) {
    problems.push(`${file}: ${lines} lines, limit is ${LIMIT} — split it before this lands.`)
  }
}

if (problems.length) {
  console.error(`File size check failed (${problems.length}):\n`)
  for (const p of problems) console.error(`  ${p}`)
  console.error('')
  process.exit(1)
}

console.log(`File size check passed — ${files.length} files, limit ${LIMIT}.`)
