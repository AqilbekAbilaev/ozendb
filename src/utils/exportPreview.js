import { cellText } from './format'

// The Export pane's preview-grid renderer: CSV and XLSX now write plain values
// (ObjectId as hex, dates as ISO text, …), not the Extended JSON `cellText` renders,
// so the preview has to pick the matching renderer for those two formats. JSON writes
// Extended JSON by default too, but can be told to write Plain JSON instead (#279) —
// `style` carries that choice ('extended' | 'plain') and only matters for the JSON
// branch, matching the backend where CSV/XLSX ignore `JsonValueStyle` entirely. Kept
// here rather than in the component because which renderer to use is a derivation
// over the format and style, not something a component should decide inline.
export function previewCellText(value, format, style) {
  if (format === 'csv' || format === 'xlsx') return plainCellText(value)
  if (format === 'json' && style === 'plain') return cellText(plainJsonValue(value))
  return cellText(value)
}

// Unwraps `value` if it is one of the single-key BSON wrapper shapes the plain
// renderers unwrap (ObjectId, Decimal128, Int64, DateTime), returning the plain value;
// `undefined` when it isn't one of those shapes, so a caller can fall back to its own
// handling. The one place that knows which wrapper keys mean what, shared by the flat
// `plainCellText` and the recursive `plainJsonValue` below so neither restates it.
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

// Renders a previewed document value the way a tabular (CSV/XLSX) export now writes
// it, so the Export pane's preview grid matches the file instead of `cellText`'s
// compact-JSON rendering of Extended JSON wrappers (`{"$oid":"…"}`). `cellText` itself
// is left alone — it's used by other preview grids that still show real EJSON.
//
// The preview's values have already crossed the Tauri boundary, so they're relaxed
// Extended JSON — plain JS objects, not BSON. This unwraps exactly the shapes that
// arrive wrapped there for the BSON types the Rust side gives a plain form: ObjectId
// (`$oid`), DateTime (`$date`, either a relaxed ISO string or the canonical nested
// `{ $numberLong }` form), Decimal128 (`$numberDecimal`), and Int64 (`$numberLong`),
// which JS wraps because it can't hold 64-bit precision losslessly. Everything else
// (documents, arrays, Binary, Timestamp, …) falls back to compact JSON, mirroring the
// Rust side's bucket for shapes with no flat form. Deliberately not recursive — CSV
// and XLSX cells have no nested structure to preserve, matching `bson_to_plain_cell`.
export function plainCellText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'object') return String(value)
  const wrapped = plainWrapperValue(value)
  return wrapped !== undefined ? wrapped : JSON.stringify(value)
}

// Recursive sibling of `plainCellText`, for a Plain JSON export preview: the same
// per-key wrapper decisions (via `plainWrapperValue`) applied at every depth, so a date
// nested inside an array of sub-documents is unwrapped too — mirrors `bson_to_plain_json`
// on the Rust side. Unlike `plainCellText`, a plain object or array is *not*
// stringified: it stays real structure, with each child converted by this same
// function, and the caller (`previewCellText`) renders the result through `cellText`.
export function plainJsonValue(value) {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.map(plainJsonValue)
  if (typeof value !== 'object') return value
  const wrapped = plainWrapperValue(value)
  if (wrapped !== undefined) return wrapped
  const out = {}
  for (const [key, val] of Object.entries(value)) out[key] = plainJsonValue(val)
  return out
}

// `$date`'s value is either a relaxed-EJSON ISO string, or the canonical
// `{ $numberLong: "<epoch ms>" }` form used for dates outside the range an ISO string
// round-trips safely. An unparseable value falls back to Extended JSON for that cell,
// matching the Rust side's fallback for a date it can't format either.
function plainDateText(date) {
  if (typeof date === 'string') return date
  if (date && typeof date === 'object' && '$numberLong' in date) {
    const parsed = new Date(Number(date.$numberLong))
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString()
  }
  return JSON.stringify({ $date: date })
}
