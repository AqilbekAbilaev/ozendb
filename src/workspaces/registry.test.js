import { describe, it, expect } from 'vitest'
import { workspaceComponentFor, workspacePaneKind, workspaceIsCollection, workspaceColorLevels, registerWorkspaceDefinition, getWorkspaceDefinition } from './registry'
import { registerWorkspaceDefinitions } from './registerDefinitions'
import { appDefinitions } from './appDefinitions'
import { queryDefinitions } from '../engines/mongodb/workspaces/queryDefinitions'
import { toolDefinitions } from '../engines/mongodb/workspaces/toolDefinitions'
import { postgresDefinitions } from '../engines/postgresql/workspaces/postgresDefinitions'
import { mysqlDefinitions } from '../engines/mysql/workspaces/mysqlDefinitions'
import { ENGINES } from '../engines/index.js'
import QuickstartPane from '../components/panes/QuickstartPane.vue'

describe('workspaceComponentFor', () => {
  it('falls back to Quickstart when there is no active tab', () => {
    expect(workspaceComponentFor(null)).toBe(QuickstartPane)
    expect(workspaceComponentFor(undefined)).toBe(QuickstartPane)
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

describe('workspaceIsCollection', () => {
  it('is true for every collection mode', () => {
    for (const type of ['mongodb.find', 'mongodb.aggregate', 'mongodb.sql_to_mql']) {
      expect(workspaceIsCollection({ type }), type).toBe(true)
    }
  })

  it('is false for other panes, unknown types and no tab', () => {
    for (const type of ['app.quickstart', 'mongodb.shell', 'mongodb.indexes', 'postgresql.table_browse', 'bogus.type']) {
      expect(workspaceIsCollection({ type }), type).toBe(false)
    }
    expect(workspaceIsCollection(null)).toBe(false)
    expect(workspaceIsCollection({ kind: 'collection' })).toBe(false)
  })
})

describe('workspaceColorLevels', () => {
  it('names the levels each tab takes a colour from, deepest first', () => {
    for (const type of ['mongodb.find', 'mongodb.aggregate', 'mongodb.sql_to_mql']) {
      expect(workspaceColorLevels({ type }), type).toEqual(['collection', 'database', 'connection'])
    }
    expect(workspaceColorLevels({ type: 'mongodb.shell' })).toEqual(['database', 'connection'])
    for (const type of ['postgresql.table_browse', 'postgresql.query', 'postgresql.search']) {
      expect(workspaceColorLevels({ type }), type).toEqual(['table', 'schema', 'database', 'connection'])
    }
  })

  it('is empty for tabs that inherit no colour, unknown types and no tab', () => {
    for (const type of ['app.quickstart', 'mongodb.indexes', 'mysql.table_browse', 'mysql.query', 'bogus.type']) {
      expect(workspaceColorLevels({ type }), type).toEqual([])
    }
    expect(workspaceColorLevels(null)).toEqual([])
  })

  // The tab bar keys each level with the engine's tag key, so a definition that takes a
  // colour must belong to an engine that has one.
  it('belongs, for every definition with levels, to an engine with a tag key', () => {
    const all = [...appDefinitions, ...queryDefinitions, ...toolDefinitions, ...postgresDefinitions, ...mysqlDefinitions]
    for (const def of all.filter((d) => d.colorLevels?.length)) {
      expect(typeof ENGINES[def.engine]?.tagKey, def.type).toBe('function')
    }
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
