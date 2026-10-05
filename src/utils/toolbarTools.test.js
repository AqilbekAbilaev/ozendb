import { describe, it, expect } from 'vitest'
import { toolbarTools } from './toolbarTools.js'
import { TOOLS } from '../constants/tools.js'

const names = (tools) => tools.map(t => (t.sep ? '|' : t.name))

describe('toolbarTools', () => {
  it('shows the MongoDB bar unchanged when MongoDB is in focus', () => {
    expect(names(toolbarTools(TOOLS, 'mongodb'))).toEqual([
      'connect', 'collection', 'shell', 'sql', 'aggregate', 'search', '|', 'schema', '|', 'export', 'import',
    ])
  })

  it("shows PostgreSQL's own buttons in their MongoDB counterparts' places", () => {
    expect(names(toolbarTools(TOOLS, 'postgresql'))).toEqual([
      'connect', 'pgTable', 'pgSql', 'pgSearch', '|', 'pgExport', 'pgImport',
    ])
  })

  it('keeps only Connect when no engine is in focus', () => {
    expect(names(toolbarTools(TOOLS, 'none'))).toEqual(['connect'])
  })

  it('never leaves a divider at either end or two in a row', () => {
    const tools = [
      { sep: true }, { name: 'a', engine: 'x' }, { sep: true }, { name: 'b', engine: 'y' },
      { sep: true }, { name: 'c', engine: 'x' }, { sep: true },
    ]
    expect(names(toolbarTools(tools, 'x'))).toEqual(['a', '|', 'c'])
  })
})
