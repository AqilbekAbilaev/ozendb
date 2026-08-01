#!/usr/bin/env node
// Hard ceiling on source file length (see AGENTS.md → Code quality → File size).
//
// Ten files were already over the limit when it was introduced, so this is a ratchet
// rather than a flat gate: those are pinned at the length they had that day and may
// only shrink. Everything else fails the moment it crosses LIMIT. The effect is that
// the debt can't grow and new god files can't appear, without blocking every PR until
// someone finds a week to split ResultTable.vue.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const LIMIT = 600

// Shrink one of these and lower its number in the same commit — the check tells you to.
// Once a file is under LIMIT, delete its line entirely.
const GRANDFATHERED = {
  'src/components/results/ResultTable.vue': 1278,
  'src/App.vue': 865,
  'src/components/connection/NewConnection.vue': 1044,
  'src-tauri/src/menu.rs': 915,
  'src-tauri/src/shell/bridge/mod.rs': 824,
  'src-tauri/src/commands/admin.rs': 820,
  'src/components/results/ResultsPanel.vue': 756,
  'src/components/connection/ConnectionManager.vue': 700,
  'src-tauri/src/commands/sql/mod.rs': 676,
}

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
  const pinned = GRANDFATHERED[file]

  if (pinned === undefined) {
    if (lines > LIMIT) {
      problems.push(`${file}: ${lines} lines, limit is ${LIMIT} — split it before this lands.`)
    }
  } else if (lines > pinned) {
    problems.push(
      `${file}: ${lines} lines, was pinned at ${pinned} — this file is known debt and must not grow.`,
    )
  } else if (lines <= LIMIT) {
    problems.push(
      `${file}: ${lines} lines, now under the ${LIMIT} limit — remove it from GRANDFATHERED in ${'scripts/check-file-size.mjs'}.`,
    )
  }
}

if (problems.length) {
  console.error(`File size check failed (${problems.length}):\n`)
  for (const p of problems) console.error(`  ${p}`)
  console.error('')
  process.exit(1)
}

console.log(`File size check passed — ${files.length} files, limit ${LIMIT}.`)
