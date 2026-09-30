import { describe, it, expect } from 'vitest'
import { newColumn, startingColumns, tableRequest, draftProblem } from './tableDraft'

describe('Create Table draft', () => {
  it('starts with an auto-numbered key column', () => {
    expect(startingColumns()).toEqual([
      { name: 'id', dataType: 'bigint', nullable: false, primaryKey: true, identity: true },
    ])
  })

  it('sends trimmed names and leaves blank rows out', () => {
    const columns = [...startingColumns(), newColumn({ name: ' title ', dataType: ' text ' }), newColumn()]
    expect(tableRequest('public', ' posts ', columns)).toEqual({
      schema: 'public',
      name: 'posts',
      columns: [
        { name: 'id', dataType: 'bigint', nullable: false, primaryKey: true, identity: true },
        { name: 'title', dataType: 'text', nullable: true, primaryKey: false, identity: false },
      ],
    })
  })

  it('says what is missing before Create can be pressed', () => {
    expect(draftProblem('', startingColumns())).toBe('Name the table.')
    expect(draftProblem('t', [newColumn()])).toBe('Add at least one column.')
    expect(draftProblem('t', [newColumn({ name: 'a', dataType: ' ' })])).toBe('Every column needs a type.')
    expect(draftProblem('t', [newColumn({ name: 'a' }), newColumn({ name: ' a ' })])).toBe('Column "a" is listed twice.')
    expect(draftProblem('t', startingColumns())).toBeNull()
  })
})
