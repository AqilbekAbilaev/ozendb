import { describe, it, expect } from 'vitest'
import { isCollectionTab } from './workspaceTypes'

describe('isCollectionTab', () => {
  it('is true for the three query workspaces that show a collection', () => {
    for (const type of ['mongodb.find', 'mongodb.aggregate', 'mongodb.sql_to_mql']) {
      expect(isCollectionTab({ type }), type).toBe(true)
    }
  })

  it('is false for every other workspace, for nothing, and for a tab named only by the old kind', () => {
    for (const type of ['mongodb.shell', 'mongodb.indexes', 'postgresql.table_browse', 'app.quickstart']) {
      expect(isCollectionTab({ type }), type).toBe(false)
    }
    expect(isCollectionTab(null)).toBe(false)
    expect(isCollectionTab({ kind: 'collection' })).toBe(false)
  })
})
