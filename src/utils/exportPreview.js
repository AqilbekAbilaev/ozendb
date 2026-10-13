import { cellText } from './format'

// Preview-grid renderer: CSV/XLSX always use the plain form; JSON uses it only when
// `style` is 'plain' — CSV/XLSX have no such choice, matching `JsonValueStyle` on the
// backend. Kept here, not in the component, since picking a renderer is a derivation.
export function previewCellText(value, format, style) {
  if (format === 'csv' || format === 'xlsx') return plainCellText(value)
  if (format === 'json' && style === 'plain') return cellText(plainJsonValue(value))
  return cellText(value)
}

// The one place that knows which single-key wrapper shapes unwrap to what (ObjectId,
// Decimal128, Int64, DateTime). `undefined` means "not a wrapper" or "a $date this
// couldn't parse" — shared by `plainCellText` and `plainJsonValue`, which pick
// different fallbacks for that case.
function plainWrapperValue(value) {
  const keys = Object.keys(value)
  if (keys.length !== 1) return undefined
  const [key] = keys
  if (key === '$oid' || key === '$numberDecimal' || key === '$numberLong') {
    return String(value[key])
  }
  if (key === '$date') return plainDateText(value.$date)
  return undefined
}

// `{ $date }` with no other keys — recognizing this shape (separately from whether it
// parses) lets `plainJsonValue` keep it as a real object on the unparseable path below.
function isDateWrapper(value) {
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === '$date'
}

// Renders a previewed value the way CSV/XLSX now write it (ObjectId as hex, dates as
// ISO text, …) instead of `cellText`'s Extended JSON. Values here are already relaxed
// EJSON (plain JS objects from across the Tauri boundary, not BSON). Not recursive —
// a CSV/XLSX cell has no nested structure to preserve, matching `bson_to_plain_cell`.
export function plainCellText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'object') return String(value)
  const wrapped = plainWrapperValue(value)
  return wrapped !== undefined ? wrapped : JSON.stringify(value)
}

// Recursive sibling of `plainCellText`, mirroring `bson_to_plain_json` on the Rust
// side: a plain object or array stays real structure instead of being stringified. An
// unparseable `$date` keeps its original object rather than recursing into it, so the
// output still reads as Extended JSON for that one value — not a flattened mismatch.
export function plainJsonValue(value) {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.map(plainJsonValue)
  if (typeof value !== 'object') return value
  const wrapped = plainWrapperValue(value)
  if (wrapped !== undefined) return wrapped
  if (isDateWrapper(value)) return value
  const out = {}
  for (const [key, val] of Object.entries(value)) out[key] = plainJsonValue(val)
  return out
}

// `$date`'s value is either a relaxed ISO string or the canonical
// `{ $numberLong: "<epoch ms>" }` form used outside that range. Returns `undefined`
// when unparseable so each caller (flat vs. recursive) picks its own fallback.
function plainDateText(date) {
  if (typeof date === 'string') return date
  if (date && typeof date === 'object' && '$numberLong' in date) {
    const parsed = new Date(Number(date.$numberLong))
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return undefined
}
