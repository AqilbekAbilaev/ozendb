import { describe, it, expect } from 'vitest'
import { workspaceComponentFor } from '../../../workspaces/registry'
import { registerWorkspaceDefinitions } from '../../../workspaces/registerDefinitions'
import {
  MongoCollectionWorkspace, ShellConsole, IndexManagerPane, SchemaPane, SearchPane,
  CurrentOpsPane, ImportPane, CsvImportPane, ExportPane,
} from './panes'

registerWorkspaceDefinitions()

describe('MongoDB workspace panes', () => {
  it.each([
    ['mongodb.find', MongoCollectionWorkspace],
    ['mongodb.aggregate', MongoCollectionWorkspace],
    ['mongodb.sql_to_mql', MongoCollectionWorkspace],
    ['mongodb.shell', ShellConsole],
    ['mongodb.indexes', IndexManagerPane],
    ['mongodb.schema', SchemaPane],
    ['mongodb.search', SearchPane],
    ['mongodb.current_operations', CurrentOpsPane],
    ['mongodb.export', ExportPane],
  ])('%s renders its own pane', (type, pane) => {
    expect(workspaceComponentFor({ type })).toBe(pane)
  })

  it('import picks its pane by format, JSON by default', () => {
    expect(workspaceComponentFor({ type: 'mongodb.import', format: 'csv' })).toBe(CsvImportPane)
    expect(workspaceComponentFor({ type: 'mongodb.import', format: 'json' })).toBe(ImportPane)
    expect(workspaceComponentFor({ type: 'mongodb.import' })).toBe(ImportPane)
  })
})
