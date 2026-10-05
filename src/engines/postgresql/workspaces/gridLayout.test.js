import { describe, it, expect } from 'vitest'
import { gridLayout } from './gridLayout.js'

const draft = (key, after = null) => ({ key, after, values: {} })

describe('gridLayout', () => {
  it('lists the loaded rows in order when nothing is staged', () => {
    expect(gridLayout(['a', 'b'], [])).toEqual([{ row: 0 }, { row: 1 }])
  })

  it('puts a new row right after the row it follows', () => {
    expect(gridLayout(['a', 'b', 'c'], [draft('n1', 'a')])).toEqual([{ row: 0 }, { draft: 'n1' }, { row: 1 }, { row: 2 }])
  })

  it('keeps several new rows after the same row in their staged order', () => {
    expect(gridLayout(['a', 'b'], [draft('n1', 'a'), draft('n2', 'a')])).toEqual([
      { row: 0 }, { draft: 'n1' }, { draft: 'n2' }, { row: 1 },
    ])
  })

  it('puts a new row with no anchor, or whose row is not on this page, at the end', () => {
    expect(gridLayout(['a', 'b'], [draft('n1'), draft('n2', 'gone')])).toEqual([
      { row: 0 }, { row: 1 }, { draft: 'n1' }, { draft: 'n2' },
    ])
  })

  it('shows a new row once even if two loaded rows share its anchor key', () => {
    expect(gridLayout(['a', 'a'], [draft('n1', 'a')])).toEqual([{ row: 0 }, { draft: 'n1' }, { row: 1 }])
  })
})
