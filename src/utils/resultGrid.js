// Pure helpers for rendering a result set as a grid: what type a value is, how it reads
// in a cell, and which columns a document set has. No DOM and no Vue — they were inline
// in ResultTable.vue, where they couldn't be tested.

// Classify a value for display. MongoDB values arrive as Extended JSON, so the wrapped
// forms are checked before the plain JS types. Decimal128 and canonical Int64 are
// deliberately classified as editable scalars rather than falling through to the generic
// 'obj', which would make the cell drill in instead of edit.
export function guessType(key, val) {
  if (key === '_id' || (val && typeof val === 'object' && '$oid' in val)) return 'id'
  if (val && typeof val === 'object' && '$date' in val) return 'date'
  // Decimal128 and (canonical) Int64 arrive Extended-JSON-wrapped. Classify them as
  // editable scalars rather than falling through to the generic 'obj' (which would make
  // the cell drill in instead of edit).
  if (val && typeof val === 'object' && '$numberDecimal' in val) return 'decimal'
  if (val && typeof val === 'object' && '$numberLong' in val) return 'num'
  if (typeof val === 'number') return 'num'
  if (typeof val === 'boolean') return 'bool'
  if (val === null || val === undefined) return 'null'
  if (Array.isArray(val) || (typeof val === 'object')) return 'obj'
  return 'str'
}

export const TYPE_CLASS = { id: 'cell-oid', str: 'cell-str', num: 'cell-num', decimal: 'cell-num', date: '', bool: 'cell-num', null: 'cell-faint', obj: 'cell-faint' }

// Render a value as the text shown in its cell. Objects and arrays collapse to a
// placeholder — the grid drills into them rather than showing them inline.
export function formatCell(key, val) {
  if (val === null || val === undefined) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'number' || typeof val === 'boolean') return String(val)
  if (Array.isArray(val)) return `Array(${val.length})`
  if (typeof val === 'object') {
    if ('$oid' in val) return val.$oid
    if ('$date' in val) {
      const d = val.$date
      if (typeof d === 'string') return d
      if (typeof d === 'object' && '$numberLong' in d) return new Date(parseInt(d.$numberLong)).toISOString()
    }
    if ('$numberLong' in val) return val.$numberLong
    if ('$numberDecimal' in val) return val.$numberDecimal
    return '{…}'
  }
  return JSON.stringify(val)
}

// The column list for a result set: the union of every document's keys, `_id` pinned
// first. An all-numeric key set (a drilled-into array) sorts numerically instead, so
// 10 lands after 9 rather than after 1.
export function columns(results) {
  if (!results?.length) return []
  const seen = new Set()
  for (const doc of results) for (const k of Object.keys(doc)) seen.add(k)
  const allNumeric = [...seen].every(k => /^\d+$/.test(k))
  if (allNumeric) return [...seen].sort((a, b) => Number(a) - Number(b))
  const rest = [...seen].filter(k => k !== '_id').sort()
  return seen.has('_id') ? ['_id', ...rest] : rest
}


// Read a nested value by key path, returning undefined if any level is missing or
// not an object. Used to resolve the drilled-into path for each row.
export function getAtPath(doc, path) {
  let cur = doc
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = cur[key]
  }
  return cur
}
