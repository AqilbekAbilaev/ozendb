import { describe, it, expect } from 'vitest'
import { parseFilter, filterBoxText } from './parseFilter.js'

describe('parseFilter', () => {
  it('ignores an empty box', () => {
    expect(parseFilter('   ', 'num')).toBe(null)
  })

  it('reads a leading comparison operator', () => {
    expect(parseFilter('>100', 'num')).toEqual({ op: 'gt', value: '100' })
    expect(parseFilter('>= 5', 'num')).toEqual({ op: 'gte', value: '5' })
    expect(parseFilter('<2026-01-01', 'date')).toEqual({ op: 'lt', value: '2026-01-01' })
    expect(parseFilter('<=3', 'num')).toEqual({ op: 'lte', value: '3' })
    expect(parseFilter('!=0', 'num')).toEqual({ op: 'ne', value: '0' })
    expect(parseFilter('<>0', 'num')).toEqual({ op: 'ne', value: '0' })
    expect(parseFilter('=Ada', 'str')).toEqual({ op: 'eq', value: 'Ada' })
  })

  it('matches numbers and booleans exactly, everything else by contains', () => {
    expect(parseFilter('42', 'num')).toEqual({ op: 'eq', value: '42' })
    expect(parseFilter('true', 'bool')).toEqual({ op: 'eq', value: 'true' })
    expect(parseFilter('2026-09', 'date')).toEqual({ op: 'contains', value: '2026-09' })
    expect(parseFilter(' ada ', 'str')).toEqual({ op: 'contains', value: 'ada' })
    expect(parseFilter('"a":1', null)).toEqual({ op: 'contains', value: '"a":1' })
  })

  it('reads null and !null as null checks', () => {
    expect(parseFilter('NULL', 'str')).toEqual({ op: 'isNull' })
    expect(parseFilter('!null', 'num')).toEqual({ op: 'notNull' })
  })

  it('leaves a bare operator unapplied', () => {
    expect(parseFilter('>', 'num')).toBe(null)
  })
})

describe('starts with and any of', () => {
  it('reads ^ as starts with, whatever the column', () => {
    expect(parseFilter('^EVOS', 'str')).toEqual({ op: 'startsWith', value: 'EVOS' })
    expect(parseFilter('^ 54', 'num')).toEqual({ op: 'startsWith', value: '54' })
    expect(parseFilter('^', 'str')).toBe(null)
  })

  it('reads a comma list as any of wherever the box would match exactly', () => {
    expect(parseFilter('1, 2', 'num')).toEqual({ op: 'in', value: '1, 2' })
    expect(parseFilter('=1,2', 'num')).toEqual({ op: 'in', value: '1,2' })
    expect(parseFilter('=Tashkent, Samarkand', 'str')).toEqual({ op: 'in', value: 'Tashkent, Samarkand' })
    expect(parseFilter('true, false', 'bool')).toEqual({ op: 'in', value: 'true, false' })
  })

  it('keeps a comma in a text search as part of what it contains', () => {
    expect(parseFilter('Tashkent, Uzbekistan', 'str')).toEqual({ op: 'contains', value: 'Tashkent, Uzbekistan' })
    expect(parseFilter('>1,2', 'num')).toEqual({ op: 'gt', value: '1,2' })
  })
})

describe('filterBoxText', () => {
  it('writes a filter as the text that types it back', () => {
    const cases = [
      [{ op: 'gt', value: '100' }, 'num', '>100'],
      [{ op: 'eq', value: '42' }, 'num', '42'],
      [{ op: 'eq', value: 'Ada' }, 'str', '=Ada'],
      [{ op: 'contains', value: 'ad' }, 'str', 'ad'],
      [{ op: 'contains', value: '2026-09' }, 'date', '2026-09'],
      [{ op: 'ne', value: 'x' }, 'str', '!=x'],
      [{ op: 'isNull' }, 'num', 'null'],
      [{ op: 'notNull' }, 'str', '!null'],
      [{ op: 'startsWith', value: 'EVOS' }, 'str', '^EVOS'],
      [{ op: 'in', value: '5411, 5812' }, 'num', '5411, 5812'],
      [{ op: 'in', value: 'a,b' }, 'str', '=a,b'],
    ]
    for (const [filter, kind, text] of cases) {
      expect(filterBoxText(filter, kind)).toBe(text)
      expect(parseFilter(text, kind)).toEqual(filter)
    }
  })

  it('gives null when no box text would type the filter back', () => {
    expect(filterBoxText({ op: 'contains', value: '4' }, 'num')).toBe(null)
    expect(filterBoxText({ op: 'contains', value: '>5' }, 'str')).toBe(null)
    expect(filterBoxText({ op: 'contains', value: 'null' }, 'str')).toBe(null)
    expect(filterBoxText({ op: 'eq', value: ' padded ' }, 'str')).toBe(null)
  })
})
