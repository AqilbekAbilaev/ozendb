import { describe, it, expect } from 'vitest'
import { columnRefs } from './columnRefs.js'

const id = { name: 'id', dataType: 'integer' }
const name = { name: 'name', dataType: 'text' }

describe('columnRefs', () => {
  it('lists every table\'s columns in order, keyed by name for the browsed table', () => {
    expect(columnRefs([{ key: '', columns: [id, name] }])).toEqual([
      { key: 'id', table: 0, name: 'id', info: id },
      { key: 'name', table: 0, name: 'name', info: name },
    ])
  })

  it('keys a joined table\'s columns by that join, so a repeated name stays apart', () => {
    const refs = columnRefs([{ key: '', columns: [id] }, { key: 'j1', columns: [id, name] }])
    expect(refs.map(r => [r.key, r.table, r.name])).toEqual([['id', 0, 'id'], ['j1.id', 1, 'id'], ['j1.name', 1, 'name']])
  })
})
