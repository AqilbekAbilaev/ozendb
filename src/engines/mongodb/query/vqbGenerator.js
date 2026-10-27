export const OPERATORS = [
  { label: 'equals',           value: 'eq',      noValue: false },
  { label: 'not equals',       value: 'ne',      noValue: false },
  { label: 'greater than',     value: 'gt',      noValue: false },
  { label: 'greater or equal', value: 'gte',     noValue: false },
  { label: 'less than',        value: 'lt',      noValue: false },
  { label: 'less or equal',    value: 'lte',     noValue: false },
  { label: 'in',               value: 'in',      noValue: false },
  { label: 'not in',           value: 'nin',     noValue: false },
  { label: 'contains',         value: 'regex',   noValue: false },
  { label: 'exists',           value: 'exists',  noValue: true  },
  { label: 'does not exist',   value: 'nexists', noValue: true  },
  { label: 'is null',          value: 'null',    noValue: true  },
]

export function detectType(val) {
  const s = (val || '').trim()
  if (!s) return 'String'
  if (s === 'true' || s === 'false') return 'Boolean'
  if (s === 'null') return 'Null'
  if (/^[0-9a-fA-F]{24}$/.test(s)) return 'ObjectId'
  if (!isNaN(Number(s)) && s !== '') return 'Number'
  return 'String'
}

function encodeValue(val) {
  const s = (val || '').trim()
  const type = detectType(s)
  if (type === 'Number')   return s
  if (type === 'Boolean')  return s
  if (type === 'Null')     return 'null'
  if (type === 'ObjectId') return `ObjectId("${s}")`
  return JSON.stringify(s)
}

// Returns the inner `"field": <expr>` pair (no surrounding braces) so callers
// can either merge several pairs into one object or wrap each in its own object.
function condPair(c) {
  const f = c.field.trim()
  if (c.op === 'null')    return `"${f}": null`
  if (c.op === 'exists')  return `"${f}": { $exists: true }`
  if (c.op === 'nexists') return `"${f}": { $exists: false }`
  if (c.op === 'eq')      return `"${f}": ${encodeValue(c.value)}`
  if (c.op === 'ne')      return `"${f}": { $ne: ${encodeValue(c.value)} }`
  if (c.op === 'gt')      return `"${f}": { $gt: ${encodeValue(c.value)} }`
  if (c.op === 'gte')     return `"${f}": { $gte: ${encodeValue(c.value)} }`
  if (c.op === 'lt')      return `"${f}": { $lt: ${encodeValue(c.value)} }`
  if (c.op === 'lte')     return `"${f}": { $lte: ${encodeValue(c.value)} }`
  if (c.op === 'regex')   return `"${f}": { $regex: ${JSON.stringify(c.value || '')}, $options: "i" }`
  if (c.op === 'in' || c.op === 'nin') {
    const vals = (c.value || '').split(',').map(v => encodeValue(v.trim())).join(', ')
    return `"${f}": { $${c.op}: [${vals}] }`
  }
  return `"${f}": ${encodeValue(c.value)}`
}

export function generateFilter(conditions, logic) {
  const active = (conditions || []).filter(c => c.enabled && c.field.trim())
  if (!active.length) return '{}'
  if (active.length === 1) return `{ ${condPair(active[0])} }`

  // A top-level object is already an implicit AND, so $and would be redundant —
  // merge the conditions into one flat object instead. The exception is when two
  // conditions target the same field: duplicate keys can't share an object, so
  // $and is genuinely required there.
  if (logic === '$and') {
    const fields = active.map(c => c.field.trim())
    const hasDuplicateFields = new Set(fields).size !== fields.length
    if (!hasDuplicateFields) {
      return `{ ${active.map(condPair).join(', ')} }`
    }
  }

  return `{ ${logic}: [ ${active.map(c => `{ ${condPair(c)} }`).join(', ')} ] }`
}

export function generateSort(fields) {
  const active = (fields || []).filter(f => f.field.trim())
  if (!active.length) return '{}'
  return `{ ${active.map(f => `"${f.field.trim()}": ${f.dir}`).join(', ')} }`
}

export function generateProjection(fields) {
  const active = (fields || []).filter(f => f.field.trim())
  if (!active.length) return '{}'
  return `{ ${active.map(f => `"${f.field.trim()}": ${f.include ? 1 : 0}`).join(', ')} }`
}
