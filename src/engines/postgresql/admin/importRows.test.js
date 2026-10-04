import { describe, it, expect } from 'vitest'
import { columnOptions, mappedCount, importedMessage, toSelections, toMapping, SKIP } from './importRows'

const columns = [
  { name: 'id', dataType: 'integer', nullable: false, hasDefault: false, generated: false },
  { name: 'name', dataType: 'text', nullable: true, hasDefault: false, generated: false },
  { name: 'doubled', dataType: 'integer', nullable: true, hasDefault: false, generated: true },
]

describe('columnOptions', () => {
  it('offers skip, then every column but the generated ones, with its type', () => {
    expect(columnOptions(columns)).toEqual([
      { value: SKIP, label: '— skip —' },
      { value: 'id', label: 'id (integer, required)' },
      { value: 'name', label: 'name (text)' },
    ])
  })
})

describe('mappedCount', () => {
  it('counts the CSV columns that land somewhere', () => {
    expect(mappedCount(['id', null, 'name'])).toBe(2)
    expect(mappedCount([null])).toBe(0)
  })
})

describe('importedMessage', () => {
  it('reports the rows imported', () => {
    expect(importedMessage(1)).toBe('Imported 1 row')
    expect(importedMessage(2500)).toBe('Imported 2,500 rows')
  })
})

describe('selections and mapping', () => {
  it('turns the backend guess into select values and back', () => {
    expect(toSelections(['id', null])).toEqual(['id', SKIP])
    expect(toMapping(['id', SKIP])).toEqual(['id', null])
    expect(mappedCount(['id', SKIP])).toBe(1)
  })
})
