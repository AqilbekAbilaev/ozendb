import { describe, it, expect } from 'vitest'
import { MODALS } from './modalRegistry'

// The registry is the single source of truth for registry-driven modals: adding a
// modal means adding a row here. This guards the row shape every consumer relies on —
// a component to render and a node level to gate/seed it.
// null = app-level singleton (no node target); the others are node depths. `table`
// is PostgreSQL-only (#129) — Postgres has no sidebar node deep enough yet
// (#145) to open one from, so it's opened directly from the table workspace.
const LEVELS = ['connection', 'database', 'collection', 'table', null]

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
})
