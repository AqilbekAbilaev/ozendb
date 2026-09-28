import { describe, it, expect } from 'vitest'
import { useColumnResize } from './useColumnResize'

describe('useColumnResize without cellData', () => {
  it('leaves every column to auto layout until one is resized', () => {
    const { colWidths, thWidthStyle } = useColumnResize({ gridColumns: () => ['id', 'name'] })
    expect(thWidthStyle('name')).toEqual({})

    colWidths.value.name = 90
    expect(thWidthStyle('name')).toEqual({ minWidth: '90px', maxWidth: '90px' })
    expect(thWidthStyle('id')).toEqual({})
  })
})
