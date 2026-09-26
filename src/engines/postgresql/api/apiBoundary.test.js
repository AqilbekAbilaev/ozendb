import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Every PostgreSQL-specific Tauri command, grouped by the API module that owns it.
// This list is the single source of truth for the boundary: a command named here
// may only be invoked from inside src/engines/postgresql/api/.
const POSTGRES_COMMANDS = [
  // resources.js
  'list_pg_schemas', 'list_pg_tables', 'list_pg_columns',
  // queries.js
  'run_pg_query', 'browse_pg_table', 'count_pg_table', 'update_pg_row',
]

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (!full.includes('engines/postgresql/api')) walk(full, files)
    } else if (full.endsWith('.js') || full.endsWith('.vue')) {
      files.push(full)
    }
  }
  return files
}

describe('PostgreSQL API boundary', () => {
  it('never invokes a PostgreSQL command outside src/engines/postgresql/api/', () => {
    const offenders = []
    for (const file of walk(join(process.cwd(), 'src'))) {
      const source = readFileSync(file, 'utf8')
      for (const command of POSTGRES_COMMANDS) {
        if (source.includes(`invoke('${command}'`)) {
          offenders.push(`${file.replace(process.cwd() + '/', '')}: invoke('${command}')`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})