import { describe, it, expect } from 'vitest'
import { WORKSPACE_COMPONENTS, workspaceComponentFor, registerWorkspaceDefinition, getWorkspaceDefinition } from './registry'
import { registerWorkspaceDefinitions } from './registerDefinitions'

describe('workspaceComponentFor', () => {
  it('renders each type\'s own component', () => {
    const cases = [
      [{ type: 'app.quickstart' }, WORKSPACE_COMPONENTS.quickstart],
      [{ type: 'mongodb.find' }, WORKSPACE_COMPONENTS.collection],
      [{ type: 'mongodb.shell' }, WORKSPACE_COMPONENTS.shell],
      [{ type: 'mongodb.indexes' }, WORKSPACE_COMPONENTS.indexes],
      [{ type: 'mongodb.schema' }, WORKSPACE_COMPONENTS.schema],
      [{ type: 'mongodb.search' }, WORKSPACE_COMPONENTS.search],
      [{ type: 'mongodb.current_operations' }, WORKSPACE_COMPONENTS.currentOps],
      [{ type: 'mongodb.export' }, WORKSPACE_COMPONENTS.export],
      [{ type: 'mongodb.import', format: 'json' }, WORKSPACE_COMPONENTS.import],
      [{ type: 'mongodb.import', format: 'csv' }, WORKSPACE_COMPONENTS['import:csv']],
    ]
    for (const [tab, expected] of cases) {
      expect(workspaceComponentFor(tab), tab.type).toBe(expected)
    }
  })

  it('renders every collection mode with the same component', () => {
    for (const type of ['mongodb.find', 'mongodb.aggregate', 'mongodb.sql_to_mql']) {
      expect(workspaceComponentFor({ type })).toBe(WORKSPACE_COMPONENTS.collection)
    }
  })

  it('lets a definition pick between components, as import does by format', () => {
    expect(workspaceComponentFor({ type: 'mongodb.import', format: 'csv' }))
      .not.toBe(workspaceComponentFor({ type: 'mongodb.import', format: 'json' }))
    expect(workspaceComponentFor({ type: 'mongodb.import' })).toBe(WORKSPACE_COMPONENTS.import)
  })

  it('falls back to Quickstart when there is no active tab', () => {
    expect(workspaceComponentFor(null)).toBe(WORKSPACE_COMPONENTS.quickstart)
    expect(workspaceComponentFor(undefined)).toBe(WORKSPACE_COMPONENTS.quickstart)
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
    expect(shell).toBe(WORKSPACE_COMPONENTS.shell)
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

  it('keeps components statically resolvable through the definitions', () => {
    expect(getWorkspaceDefinition('mongodb.find').component).toBe(WORKSPACE_COMPONENTS.collection)
    expect(getWorkspaceDefinition('mongodb.shell').component).toBe(WORKSPACE_COMPONENTS.shell)
    expect(getWorkspaceDefinition('app.quickstart').component).toBe(WORKSPACE_COMPONENTS.quickstart)
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