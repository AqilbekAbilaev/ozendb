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

// The rows the grid renders: the results, or once drilled each document's value at the
// path — one row per document, so a missing path renders blank rather than vanishing.
// An array spreads into index-keyed columns.
export function drillRows(results, drillPath) {
  if (!results) return []
  if (!drillPath.length) return results
  return results.map((doc) => {
    const val = getAtPath(doc, drillPath) ?? {}
    if (Array.isArray(val)) {
      const obj = {}
      val.forEach((el, idx) => { obj[String(idx)] = el })
      return obj
    }
    return val
  })
}

// Each cell's shown text, colour classes and drillability, worked out once per result
// set rather than per render. `rows[r][c]` is the cell for row r and `cols[c]`.
export function cellRows(rows, cols) {
  return rows.map((row) =>
    cols.map((col) => {
      const val = row[col]
      const type = guessType(col, val)
      return {
        col: col,
        display: formatCell(col, val),
        typeClass: 't-' + type,
        valClass: TYPE_CLASS[type],
        drillable: type === 'obj',
      }
    })
  )
}

// Every `{ row, col }` whose shown text contains the query, ignoring case.
export function findMatches(cells, cols, query) {
  const q = query.toLowerCase()
  if (!q) return []
  const out = []
  for (let r = 0; r < cells.length; r++) {
    const row = cells[r]
    if (!row) continue
    for (let c = 0; c < cols.length; c++) {
      if (row[c].display.toLowerCase().includes(q)) out.push({ row: r, col: cols[c] })
    }
  }
  return out
}
