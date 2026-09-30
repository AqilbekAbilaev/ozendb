import { describe, it, expect } from 'vitest'
import { useColumnResize, fitWidth } from './useColumnResize'

describe('useColumnResize without cellData', () => {
  it('leaves every column to auto layout until one is resized', () => {
    const { colWidths, thWidthStyle } = useColumnResize({ gridColumns: () => ['id', 'name'] })
    expect(thWidthStyle('name')).toEqual({})

    colWidths.value.name = 90
    expect(thWidthStyle('name')).toEqual({ minWidth: '90px', maxWidth: '90px' })
    expect(thWidthStyle('id')).toEqual({})
  })
})

// A pinned width has to fit the header, not just the values: a PostgreSQL header
// carries the column's type under its name and a filter box under that, and a column
// pinned to the name alone came out narrower than its own input could be drawn.
describe('useColumnResize with cellData', () => {
  const cells = (...values) => () => [values.map(display => ({ display }))]

  it('measures the header text the caller names, not the raw column key', () => {
    const { thWidthStyle } = useColumnResize({
      gridColumns: () => ['a'],
      cellData: cells('1'),
      headerLabel: () => 'character varying',   // longer than the key or the value
    })
    // 17 characters at the fallback char width, plus the cell's padding.
    expect(Number.parseInt(thWidthStyle('a').minWidth, 10)).toBeGreaterThan(120)
  })

  it('never pins a column below the floor the caller sets', () => {
    const narrow = { gridColumns: () => ['a'], cellData: cells('1'), headerLabel: () => 'id' }
    expect(Number.parseInt(useColumnResize(narrow).thWidthStyle('a').minWidth, 10)).toBeLessThan(116)

    const floored = useColumnResize({ ...narrow, minWidth: () => 116 })
    expect(floored.thWidthStyle('a')).toEqual({ minWidth: '116px', maxWidth: '116px' })
  })

  it('leaves a wide column alone rather than shrinking it to the floor', () => {
    const { thWidthStyle } = useColumnResize({
      gridColumns: () => ['a'],
      cellData: cells('a value long enough to need more than the floor'),
      headerLabel: () => 'a',
      minWidth: () => 116,
    })
    expect(Number.parseInt(thWidthStyle('a').minWidth, 10)).toBeGreaterThan(116)
  })

  it('still lets a user resize below the floor — a drag is deliberate', () => {
    const { colWidths, thWidthStyle } = useColumnResize({
      gridColumns: () => ['a'], cellData: cells('1'), headerLabel: () => 'a', minWidth: () => 116,
    })
    colWidths.value.a = 60
    expect(thWidthStyle('a')).toEqual({ minWidth: '60px', maxWidth: '60px' })
  })
})

describe('fitWidth', () => {
  it('sizes a column to its content, no narrower than 40px and no wider than the grid shows a cell', () => {
    expect(fitWidth(120)).toBe(120)
    expect(fitWidth(12)).toBe(40)
    expect(fitWidth(2186)).toBe(360)
  })
})
