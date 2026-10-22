import { describe, it, expect } from 'vitest'
import { valueText, rowsAsTsv, rowsAsJson } from './copyText.js'

describe('valueText', () => {
  it('copies a value as the grid shows it, and NULL as nothing', () => {
    expect(valueText('12.50')).toBe('12.50')
    expect(valueText(true)).toBe('true')
    expect(valueText({ a: [1] })).toBe('{"a":[1]}')
    expect(valueText(null)).toBe('')
  })
})

describe('rowsAsTsv', () => {
  it('puts a row per line, its values tab-separated', () => {
    expect(rowsAsTsv([['1', 'EVOS', null], ['2', 'Korzinka', true]])).toBe('1\tEVOS\t\n2\tKorzinka\ttrue')
  })

  it('quotes a value holding a tab, line break or quote, so it stays one cell', () => {
    expect(rowsAsTsv([['a\tb', 'line\nbreak', 'say "hi"', 'plain']]))
      .toBe('"a\tb"\t"line\nbreak"\t"say ""hi"""\tplain')
  })
})

describe('rowsAsJson', () => {
  it('copies one row as an object keyed by column', () => {
    expect(JSON.parse(rowsAsJson(['id', 'tags'], [['1', ['a']]]))).toEqual({ id: '1', tags: ['a'] })
  })

  it('copies several as a list of them', () => {
    expect(JSON.parse(rowsAsJson(['id'], [['1'], [null]]))).toEqual([{ id: '1' }, { id: null }])
  })
})
