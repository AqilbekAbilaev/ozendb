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

// Mirrors `bson_to_plain_cell`. Values here are already relaxed EJSON (plain JS
// objects, not BSON); not recursive, since a flat cell has no nested structure.
export function plainCellText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'object') return String(value)
  const wrapped = plainWrapperValue(value)
  return wrapped !== undefined ? wrapped : JSON.stringify(value)
}

// Mirrors `bson_to_plain_json`: a plain object or array stays real structure. An
// unparseable `$date` keeps its original object, so that one value still reads as
// Extended JSON rather than a flattened mismatch.
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

// `$date`'s value is either a relaxed ISO string (1970-9999, passed through unchanged —
// it already matches the file) or the canonical `{ $numberLong: "<epoch ms>" }` form used
// outside that range. Returns `undefined` when unparseable, or when the year falls
// outside what `try_to_rfc3339_string` on the Rust side can render (0-9999), so each
// caller (flat vs. recursive) takes its own existing Extended JSON fallback.
function plainDateText(date) {
  if (typeof date === 'string') return date
  if (date && typeof date === 'object' && '$numberLong' in date) {
    const parsed = new Date(Number(date.$numberLong))
    if (Number.isNaN(parsed.getTime())) return undefined
    const year = parsed.getUTCFullYear()
    if (year < 0 || year > 9999) return undefined
    return trimFractionalZeros(parsed.toISOString())
  }
  return undefined
}

// `toISOString()` always emits exactly three fractional digits; the file's
// `try_to_rfc3339_string` trims trailing zeros, dropping the fraction entirely when it's
// all zero. Matches that so a 1965 date with 550ms (or 0ms) agrees with the file.
function trimFractionalZeros(iso) {
  return iso.replace(/\.(\d+)Z$/, (_, fraction) => {
    const trimmed = fraction.replace(/0+$/, '')
    return trimmed ? `.${trimmed}Z` : 'Z'
  })
}
