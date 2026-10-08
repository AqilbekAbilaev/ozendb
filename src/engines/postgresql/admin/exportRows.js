import { fmtBytes } from '../../../utils/format'

// What the export dialog sends and says (#128). A target is a sidebar table node
// `{ connId, database, schema, table }` or a SQL editor's `{ connId, database, query }`.

export const EXPORT_FORMATS = [
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
]

export function exportSource(target) {
  return target.table ? { schema: target.schema, table: target.table } : { query: target.query }
}

export function exportLabel(target) {
  return target.table ? `Table ${target.schema}.${target.table}` : 'Query results'
}

export function defaultFileName(target, format) {
  return `${target.table || 'query'}.${format}`
}

// CSV comes back as bytes only: COPY's rows can hold newlines, so they aren't counted.
export function exportedMessage(result) {
  if (result.rows == null) return `Exported ${fmtBytes(result.bytes)}`
  return `Exported ${result.rows.toLocaleString('en-US')} row${result.rows === 1 ? '' : 's'}`
}
