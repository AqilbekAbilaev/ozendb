import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { MODALS, MODAL_TABLES } from './modalRegistry'
import { ENGINES } from '../engines/index.js'

// The registry is the single source of truth for registry-driven modals: adding a
// modal means adding a row here. This guards the row shape every consumer relies on —
// a component to render and a node level to gate/seed it.
// null = app-level singleton (no node target); the others are node depths. `table`
// is PostgreSQL-only (#129) — Postgres has no sidebar node deep enough yet
// (#145) to open one from, so it's opened directly from the table workspace.
const LEVELS = ['connection', 'database', 'collection', 'table', null]

// Every dialog id the app's code names as a literal when it opens, closes, checks or
// gates a dialog.
function idsNamedInSource(dir, out = new Set()) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) idsNamedInSource(full, out)
    else if (/\.(js|vue)$/.test(entry) && !/\.test\.js$/.test(entry)) {
      const source = readFileSync(full, 'utf8')
      for (const m of source.matchAll(/\b(?:openModal|closeModal|isModalOpen|modalFeature)\(\s*'([^']+)'/g)) out.add(m[1])
    }
  }
  return out
}

describe('modal registry', () => {
  it('has at least one modal registered', () => {
    expect(Object.keys(MODALS).length).toBeGreaterThan(0)
  })

  it('every entry declares a component and a valid level', () => {
    for (const [id, entry] of Object.entries(MODALS)) {
      expect(entry.component, `${id} must declare a component`).toBeTruthy()
      expect(LEVELS, `${id} must declare a valid level`).toContain(entry.level)
    }
  })

  it('gives no id to two tables, since merging them would hide one dialog', () => {
    const ids = MODAL_TABLES.flatMap((table) => Object.keys(table))
    const repeated = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(repeated).toEqual([])
  })

  it('resolves every dialog id the app opens by name', () => {
    const named = [...idsNamedInSource('src')]
    expect(named.length).toBeGreaterThan(0)
    expect(named.filter((id) => !MODALS[id])).toEqual([])
  })

  it('resolves the dialogs each SQL engine names for its shared tabs', () => {
    for (const [name, engine] of Object.entries(ENGINES)) {
      for (const id of Object.values(engine.sql?.modals ?? {})) {
        expect(MODALS[id], `${name}: ${id}`).toBeDefined()
      }
    }
  })
})
