import { describe, it, expect } from 'vitest'
import { plainCellText, plainJsonValue, previewCellText } from './exportPreview'

describe('previewCellText', () => {
  it('renders the plain form for csv and xlsx regardless of the json style argument', () => {
    const wrapped = { $oid: '5f8d0d55b54764421b7156c3' }
    expect(previewCellText(wrapped, 'csv', 'plain')).toBe('5f8d0d55b54764421b7156c3')
    expect(previewCellText(wrapped, 'xlsx', 'plain')).toBe('5f8d0d55b54764421b7156c3')
    // The style argument is JSON-only — passing 'extended' must not change the
    // CSV/XLSX branch, since those formats have no Extended-vs-Plain choice at all.
    expect(previewCellText(wrapped, 'csv', 'extended')).toBe('5f8d0d55b54764421b7156c3')
    expect(previewCellText(wrapped, 'xlsx', 'extended')).toBe('5f8d0d55b54764421b7156c3')
  })

  it('keeps showing real Extended JSON for json when the style is extended (or omitted)', () => {
    expect(previewCellText({ $oid: '5f8d0d55b54764421b7156c3' }, 'json', 'extended')).toBe('{"$oid":"5f8d0d55b54764421b7156c3"}')
    expect(previewCellText({ $oid: '5f8d0d55b54764421b7156c3' }, 'json')).toBe('{"$oid":"5f8d0d55b54764421b7156c3"}')
  })

  it('renders the unwrapped plain form for json when the style is plain', () => {
    expect(previewCellText({ $oid: '5f8d0d55b54764421b7156c3' }, 'json', 'plain')).toBe('5f8d0d55b54764421b7156c3')
  })

  it('unwraps a date nested inside an array of sub-documents for json + plain, but keeps it wrapped for json + extended', () => {
    // The nested case that matters most: an array of sub-documents each holding an
    // $oid and a $date must come out fully unwrapped for Plain, and must stay exactly
    // as Extended JSON renders it today when the style is Extended — proving the new
    // branch doesn't leak into the one #281 already got right.
    const value = {
      events: [
        { id: { $oid: '5f8d0d55b54764421b7156c3' }, at: { $date: '2024-03-07T09:15:30.000Z' } },
        { id: { $oid: '5f8d0d55b54764421b7156c4' }, at: { $date: '2024-03-07T09:15:30.000Z' } },
      ],
    }
    const plain = previewCellText(value, 'json', 'plain')
    expect(plain).not.toContain('$oid')
    expect(plain).not.toContain('$date')
    expect(JSON.parse(plain)).toEqual({
      events: [
        { id: '5f8d0d55b54764421b7156c3', at: '2024-03-07T09:15:30.000Z' },
        { id: '5f8d0d55b54764421b7156c4', at: '2024-03-07T09:15:30.000Z' },
      ],
    })
    const extended = previewCellText(value, 'json', 'extended')
    expect(extended).toBe(JSON.stringify(value))
  })

  it('blanks null and undefined regardless of format or style', () => {
    expect(previewCellText(null, 'csv', 'plain')).toBe('')
    expect(previewCellText(undefined, 'json', 'plain')).toBe('')
    expect(previewCellText(undefined, 'json', 'extended')).toBe('')
  })
})

describe('plainJsonValue', () => {
  it('unwraps an ObjectId wrapper to a bare hex string', () => {
    expect(plainJsonValue({ $oid: '5f8d0d55b54764421b7156c3' })).toBe('5f8d0d55b54764421b7156c3')
  })

  it('unwraps a Decimal128 and an Int64 wrapper to their number text', () => {
    expect(plainJsonValue({ $numberDecimal: '19.99' })).toBe('19.99')
    expect(plainJsonValue({ $numberLong: '9000000000' })).toBe('9000000000')
  })

  it('unwraps both date shapes to ISO text', () => {
    expect(plainJsonValue({ $date: '2024-03-07T09:15:30.000Z' })).toBe('2024-03-07T09:15:30.000Z')
    expect(plainJsonValue({ $date: { $numberLong: '1709802930000' } })).toBe('2024-03-07T09:15:30.000Z')
  })

  it('keeps scalars, null and arrays of scalars unchanged', () => {
    expect(plainJsonValue('Garçon')).toBe('Garçon')
    expect(plainJsonValue(0)).toBe(0)
    expect(plainJsonValue(null)).toBe(null)
    expect(plainJsonValue(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('recurses through a document, unwrapping a nested scalar without stringifying the document', () => {
    const value = plainJsonValue({ café: { who: { $oid: '5f8d0d55b54764421b7156c3' } } })
    expect(value).toEqual({ café: { who: '5f8d0d55b54764421b7156c3' } })
  })

  it('recurses through an array of sub-documents, unwrapping an id and a date in each', () => {
    const value = plainJsonValue([
      { id: { $oid: '5f8d0d55b54764421b7156c3' }, at: { $date: '2024-03-07T09:15:30.000Z' } },
      { id: { $oid: '5f8d0d55b54764421b7156c4' }, at: { $date: '2024-03-07T09:15:30.000Z' } },
    ])
    expect(value).toEqual([
      { id: '5f8d0d55b54764421b7156c3', at: '2024-03-07T09:15:30.000Z' },
      { id: '5f8d0d55b54764421b7156c4', at: '2024-03-07T09:15:30.000Z' },
    ])
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
