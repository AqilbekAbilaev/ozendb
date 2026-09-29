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

describe('fitWidth', () => {
  it('sizes a column to its content, no narrower than 40px and no wider than the grid shows a cell', () => {
    expect(fitWidth(120)).toBe(120)
    expect(fitWidth(12)).toBe(40)
    expect(fitWidth(2186)).toBe(360)
  })
})
