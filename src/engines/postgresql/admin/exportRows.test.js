import { describe, it, expect } from 'vitest'
import { EXPORT_FORMATS, exportSource, exportLabel, defaultFileName, exportedMessage } from './exportRows'

const tableTarget = { connId: 'p1', database: 'shop', schema: 'public', table: 'orders' }
const queryTarget = { connId: 'p1', database: 'shop', query: 'SELECT * FROM orders WHERE total > 10' }

describe('export targets', () => {
  it('offers CSV and JSON', () => {
    expect(EXPORT_FORMATS.map(f => f.value)).toEqual(['csv', 'json'])
  })

  it('sends a table or a query, never both', () => {
    expect(exportSource(tableTarget)).toEqual({ schema: 'public', table: 'orders' })
    expect(exportSource(queryTarget)).toEqual({ query: 'SELECT * FROM orders WHERE total > 10' })
  })

  it('names what is being exported', () => {
    expect(exportLabel(tableTarget)).toBe('Table public.orders')
    expect(exportLabel(queryTarget)).toBe('Query results')
  })

  it('suggests a file name with the format\'s extension', () => {
    expect(defaultFileName(tableTarget, 'csv')).toBe('orders.csv')
    expect(defaultFileName(queryTarget, 'json')).toBe('query.json')
  })
})

describe('exportedMessage', () => {
  it('counts rows when the export knows them', () => {
    expect(exportedMessage({ rows: 1, bytes: 10 })).toBe('Exported 1 row')
    expect(exportedMessage({ rows: 12345, bytes: 10 })).toBe('Exported 12,345 rows')
  })

  it('falls back to the size for CSV', () => {
    expect(exportedMessage({ rows: null, bytes: 512 })).toBe('Exported 512 B')
    expect(exportedMessage({ rows: null, bytes: 2048 })).toBe('Exported 2.0 KB')
  })
})
