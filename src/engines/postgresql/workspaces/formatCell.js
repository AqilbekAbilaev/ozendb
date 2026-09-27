// A grid cell's text. Numerics arrive as strings (exact precision), JSON and arrays
// as structured values.
export function formatCell(value) {
  if (value === null) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// How a column's cells are styled, from its format_type() name. Arrays and JSON show
// as JSON text, so they stay plain whatever their element type.
const KINDS = [
  [/^(smallint|integer|bigint|numeric|decimal|real|double precision|money)\b/, 'num'],
  [/^(text|character|varchar|citext|uuid|name)\b/, 'str'],
  [/^(timestamp|date|time|interval)\b/, 'date'],
  [/^boolean$/, 'bool'],
]
export function cellKind(dataType) {
  if (!dataType || dataType.endsWith('[]')) return null
  return KINDS.find(([pattern]) => pattern.test(dataType))?.[1] ?? null
}
