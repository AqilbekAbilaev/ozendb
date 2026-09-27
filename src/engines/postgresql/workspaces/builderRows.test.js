import { describe, it, expect } from 'vitest'
import { operatorsFor, rowsFromBoxes, boxesFromRows, rowsFromParts, partsFromRows } from './builderRows.js'

describe('operatorsFor', () => {
  it('offers comparisons for numbers, contains for text, and null checks for every column', () => {
    const ops = (kind) => operatorsFor(kind).map(o => o.op)
    expect(ops('num')).toEqual(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'isNull', 'notNull'])
    expect(ops('date')).toEqual(['contains', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'isNull', 'notNull'])
    expect(ops('str')).toEqual(['contains', 'eq', 'ne', 'isNull', 'notNull'])
    expect(ops('bool')).toEqual(['eq', 'isNull', 'notNull'])
    expect(ops(null)).toEqual(['contains', 'eq', 'ne', 'isNull', 'notNull'])
  })
})

describe('rows and boxes', () => {
  const kinds = { id: 'num', name: 'str', at: 'date' }

  it('reads each filled box as a condition row', () => {
    expect(rowsFromBoxes({ id: '>5', name: 'ad', at: '  ', gone: '' }, kinds)).toEqual([
      { column: 'id', op: 'gt', value: '5' },
      { column: 'name', op: 'contains', value: 'ad' },
    ])
    expect(rowsFromBoxes({ name: 'null' }, kinds)).toEqual([{ column: 'name', op: 'isNull', value: '' }])
  })

  it('writes condition rows back as box text, skipping ones still missing a value', () => {
    const rows = [
      { column: 'id', op: 'gte', value: '2' },
      { column: 'name', op: 'eq', value: 'Ada' },
      { column: 'at', op: 'notNull', value: '' },
      { column: 'mcc', op: 'lt', value: '' },
    ]
    expect(boxesFromRows(rows, kinds)).toEqual({ id: '>=2', name: '=Ada', at: '!null' })
  })

  it('round-trips a row through its box text', () => {
    const rows = [{ column: 'id', op: 'eq', value: '7' }, { column: 'name', op: 'ne', value: 'x' }]
    expect(rowsFromBoxes(boxesFromRows(rows, kinds), kinds)).toEqual(rows)
  })
})

describe('rows with paused conditions', () => {
  const kinds = { id: 'num', name: 'str' }

  it('lists applied rows, then paused ones marked off', () => {
    expect(rowsFromParts({ id: '>1' }, { name: 'ad' }, kinds)).toEqual([
      { column: 'id', op: 'gt', value: '1', on: true },
      { column: 'name', op: 'contains', value: 'ad', on: false },
    ])
  })

  it('shows a column once, as applied, when the grid filled a paused one', () => {
    expect(rowsFromParts({ name: 'x' }, { name: 'ad' }, kinds)).toEqual([{ column: 'name', op: 'contains', value: 'x', on: true }])
  })

  it('splits rows back into box text and paused text', () => {
    const rows = [{ column: 'id', op: 'gt', value: '1', on: false }, { column: 'name', op: 'contains', value: 'ad', on: true }]
    expect(partsFromRows(rows, kinds)).toEqual({ texts: { name: 'ad' }, paused: { id: '>1' } })
  })
})
