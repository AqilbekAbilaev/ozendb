import { describe, it, expect } from 'vitest'
import { workspaceComponentFor, workspacePaneKind, registerWorkspaceDefinition, getWorkspaceDefinition } from './registry'
import { registerWorkspaceDefinitions } from './registerDefinitions'

describe('workspaceComponentFor', () => {
  it('renders each type\'s own component', () => {
    const types = [
      'app.quickstart', 'mongodb.find', 'mongodb.shell', 'mongodb.indexes',
      'mongodb.schema', 'mongodb.search', 'mongodb.current_operations', 'mongodb.export',
    ]
    for (const type of types) {
      expect(workspaceComponentFor({ type }), type).toBe(getWorkspaceDefinition(type).component)
    }
  })

  it('renders every collection mode with the same component', () => {
    const expected = getWorkspaceDefinition('mongodb.find').component
    for (const type of ['mongodb.find', 'mongodb.aggregate', 'mongodb.sql_to_mql']) {
      expect(workspaceComponentFor({ type })).toBe(expected)
    }
  })

  it('lets a definition pick between components, as import does by format', () => {
    const csv = workspaceComponentFor({ type: 'mongodb.import', format: 'csv' })
    const json = workspaceComponentFor({ type: 'mongodb.import', format: 'json' })
    expect(csv).not.toBe(json)
    expect(workspaceComponentFor({ type: 'mongodb.import' })).toBe(json)
  })

  it('falls back to Quickstart when there is no active tab', () => {
    const quickstart = getWorkspaceDefinition('app.quickstart').component
    expect(workspaceComponentFor(null)).toBe(quickstart)
    expect(workspaceComponentFor(undefined)).toBe(quickstart)
  })

  it('renders an engine\'s workspace from its definition alone', () => {
    const component = { name: 'EngineOwnedPane' }
    registerWorkspaceDefinition({ type: 'test.engine_owned', component })
    expect(workspaceComponentFor({ type: 'test.engine_owned' })).toBe(component)
  })

  it('goes by type alone: a legacy kind without one renders nothing', () => {
    expect(workspaceComponentFor({ kind: 'collection' })).toBe(null)
    expect(workspaceComponentFor({ type: 'bogus.type' })).toBe(null)
    expect(workspaceComponentFor({})).toBe(null)
  })

  it('returns stable component identity on repeated resolution', () => {
    expect(workspaceComponentFor({ type: 'mongodb.find' })).toBe(workspaceComponentFor({ type: 'mongodb.find' }))
    expect(workspaceComponentFor({ type: 'mongodb.shell' })).toBe(workspaceComponentFor({ type: 'mongodb.shell' }))
    expect(workspaceComponentFor(null)).toBe(workspaceComponentFor(undefined))
  })

  it('keeps the shell component lazy-loaded', () => {
    const shell = workspaceComponentFor({ type: 'mongodb.shell' })
    // The async wrapper is a component definition, not the pane module itself.
    expect(typeof shell).toBe('object')
    expect(shell).toBe(getWorkspaceDefinition('mongodb.shell').component)
  })
})

describe('workspacePaneKind', () => {
  it('marks quickstart for no active tab and for the quickstart type', () => {
    expect(workspacePaneKind(null)).toBe('quickstart')
    expect(workspacePaneKind(undefined)).toBe('quickstart')
    expect(workspacePaneKind({ type: 'app.quickstart' })).toBe('quickstart')
  })

  it('marks every collection mode for the shared binding', () => {
    for (const type of ['mongodb.find', 'mongodb.aggregate', 'mongodb.sql_to_mql']) {
      expect(workspacePaneKind({ type })).toBe('collection')
    }
  })

  it('leaves ordinary panes and unknown types unmarked', () => {
    expect(workspacePaneKind({ type: 'mongodb.shell' })).toBe(null)
    expect(workspacePaneKind({ type: 'mongodb.indexes' })).toBe(null)
    expect(workspacePaneKind({ type: 'bogus.type' })).toBe(null)
  })
})

// Once per file: the definitions map is module-scope, so registering in a hook would
// throw on the second test.
registerWorkspaceDefinitions()

describe('workspace definition registry', () => {
  it('registers every expected workspace type exactly once', () => {
    const expected = [
      'app.quickstart',
      'mongodb.find',
      'mongodb.aggregate',
      'mongodb.sql_to_mql',
      'mongodb.shell',
      'mongodb.indexes',
      'mongodb.schema',
      'mongodb.search',
      'mongodb.import',
      'mongodb.export',
      'mongodb.current_operations',
      'postgresql.table_browse',
      'postgresql.query',
    ]
    for (const type of expected) {
      expect(getWorkspaceDefinition(type).type).toBe(type)
    }
  })

  it('fails on duplicate registration in development and tests', () => {
    registerWorkspaceDefinition({
      type: 'test.once', engine: 'test', component: null,
      create: () => ({ title: 'x', fields: {} }),
    })
    expect(() => registerWorkspaceDefinition({
      type: 'test.once', engine: 'test', component: null,
      create: () => ({ title: 'x', fields: {} }),
    })).toThrow(/Duplicate workspace type: test\.once/)
  })

  it('fails clearly for an unknown type', () => {
    expect(() => getWorkspaceDefinition('no.such.type')).toThrow(/Unknown workspace type: no\.such\.type/)
  })
})
