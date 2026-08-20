import { describe, it, expect } from 'vitest'
import { WORKSPACE_COMPONENTS, workspaceComponentFor } from './registry'

describe('workspaceComponentFor', () => {
  it('resolves every current tab kind', () => {
    const cases = [
      [{ kind: 'quickstart' }, WORKSPACE_COMPONENTS.quickstart],
      [{ kind: 'collection', mode: 'find' }, WORKSPACE_COMPONENTS.collection],
      [{ kind: 'shell' }, WORKSPACE_COMPONENTS.shell],
      [{ kind: 'indexes' }, WORKSPACE_COMPONENTS.indexes],
      [{ kind: 'schema' }, WORKSPACE_COMPONENTS.schema],
      [{ kind: 'search' }, WORKSPACE_COMPONENTS.search],
      [{ kind: 'currentOps' }, WORKSPACE_COMPONENTS.currentOps],
      [{ kind: 'export' }, WORKSPACE_COMPONENTS.export],
      [{ kind: 'import', format: 'json' }, WORKSPACE_COMPONENTS.import],
      [{ kind: 'import', format: 'csv' }, WORKSPACE_COMPONENTS['import:csv']],
    ]
    for (const [tab, expected] of cases) {
      expect(workspaceComponentFor(tab)).toBe(expected)
    }
  })

  it('maps every collection mode to the same component', () => {
    for (const mode of ['find', 'aggregate', 'sql', undefined]) {
      expect(workspaceComponentFor({ kind: 'collection', mode: mode })).toBe(WORKSPACE_COMPONENTS.collection)
    }
  })

  it('distinguishes csv import from other import formats', () => {
    expect(workspaceComponentFor({ kind: 'import', format: 'csv' }))
      .not.toBe(workspaceComponentFor({ kind: 'import', format: 'json' }))
    expect(workspaceComponentFor({ kind: 'import' })).toBe(WORKSPACE_COMPONENTS.import)
  })

  it('falls back to Quickstart when there is no active tab', () => {
    expect(workspaceComponentFor(null)).toBe(WORKSPACE_COMPONENTS.quickstart)
    expect(workspaceComponentFor(undefined)).toBe(WORKSPACE_COMPONENTS.quickstart)
  })

  it('returns null for unknown kinds, preserving blank-pane behavior', () => {
    expect(workspaceComponentFor({ kind: 'bogus' })).toBe(null)
    expect(workspaceComponentFor({})).toBe(null)
  })

  it('returns stable component identity on repeated resolution', () => {
    expect(workspaceComponentFor({ kind: 'collection' })).toBe(workspaceComponentFor({ kind: 'collection' }))
    expect(workspaceComponentFor({ kind: 'shell' })).toBe(workspaceComponentFor({ kind: 'shell' }))
    expect(workspaceComponentFor(null)).toBe(workspaceComponentFor(undefined))
  })

  it('keeps the shell component lazy-loaded', () => {
    const shell = workspaceComponentFor({ kind: 'shell' })
    // The async wrapper is a component definition, not the pane module itself.
    expect(typeof shell).toBe('object')
    expect(shell).toBe(WORKSPACE_COMPONENTS.shell)
  })
})