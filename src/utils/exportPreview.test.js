import { describe, it, expect } from 'vitest'
import { plainCellText, previewCellText } from './exportPreview'

describe('previewCellText', () => {
  it('renders the plain form for csv and xlsx', () => {
    const wrapped = { $oid: '5f8d0d55b54764421b7156c3' }
    expect(previewCellText(wrapped, 'csv')).toBe('5f8d0d55b54764421b7156c3')
    expect(previewCellText(wrapped, 'xlsx')).toBe('5f8d0d55b54764421b7156c3')
  })

  it('keeps showing real Extended JSON for json, the easy branch to lose', () => {
    expect(previewCellText({ $oid: '5f8d0d55b54764421b7156c3' }, 'json')).toBe('{"$oid":"5f8d0d55b54764421b7156c3"}')
  })

  it('blanks null and undefined regardless of format', () => {
    expect(previewCellText(null, 'csv')).toBe('')
    expect(previewCellText(undefined, 'json')).toBe('')
  })
})

describe('plainCellText', () => {
  it('renders an ObjectId wrapper as plain hex', () => {
    expect(plainCellText({ $oid: '5f8d0d55b54764421b7156c3' })).toBe('5f8d0d55b54764421b7156c3')
  })

  it('renders a relaxed-EJSON date string unchanged', () => {
    expect(plainCellText({ $date: '2024-03-07T09:15:30.000Z' })).toBe('2024-03-07T09:15:30.000Z')
  })

  it('renders a canonical nested $numberLong date as ISO text', () => {
    // 1709802930000 ms = 2024-03-07T09:15:30.000Z — the canonical shape used for
    // dates outside the range a plain ISO string round-trips safely.
    expect(plainCellText({ $date: { $numberLong: '1709802930000' } })).toBe('2024-03-07T09:15:30.000Z')
  })

  it('falls back to extended JSON for an unparseable date', () => {
    expect(plainCellText({ $date: { $numberLong: 'not a number' } })).toBe('{"$date":{"$numberLong":"not a number"}}')
  })

  it('renders a Decimal128 wrapper as its number text', () => {
    expect(plainCellText({ $numberDecimal: '19.99' })).toBe('19.99')
  })

  it('renders an Int64 wrapper as its plain number text', () => {
    expect(plainCellText({ $numberLong: '9000000000' })).toBe('9000000000')
  })

  it('blanks null and undefined', () => {
    expect(plainCellText(null)).toBe('')
    expect(plainCellText(undefined)).toBe('')
  })

  it('renders scalars as strings, matching cellText', () => {
    expect(plainCellText('Café de l\'Opéra')).toBe('Café de l\'Opéra')
    expect(plainCellText(0)).toBe('0')
    expect(plainCellText(false)).toBe('false')
  })

  it('falls back to compact JSON for a nested document with no flat form', () => {
    expect(plainCellText({ street: "Rue de l'Église", no: 12 })).toBe('{"street":"Rue de l\'Église","no":12}')
  })

  it('falls back to compact JSON for an array', () => {
    expect(plainCellText(['a', 'b', 'c'])).toBe('["a","b","c"]')
  })
})
