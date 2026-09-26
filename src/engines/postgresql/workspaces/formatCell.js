// A grid cell's text. Numerics arrive as strings (exact precision), JSON and arrays
// as structured values.
export function formatCell(value) {
  if (value === null) return 'NULL'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
