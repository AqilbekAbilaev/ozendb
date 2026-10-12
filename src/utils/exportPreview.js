import { cellText } from './format'

// The Export pane's preview-grid renderer: CSV and XLSX now write plain values
// (ObjectId as hex, dates as ISO text, …), not the Extended JSON `cellText` renders,
// so the preview has to pick the matching renderer for those two formats and keep
// showing real EJSON for JSON, which still writes it. Kept here rather than in the
// component because which renderer to use is a derivation over the format, not
// something a component should decide inline.
export function previewCellText(value, format) {
  return format === 'csv' || format === 'xlsx' ? plainCellText(value) : cellText(value)
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
// Rust side's bucket for shapes with no flat form.
export function plainCellText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'object') return String(value)
  const keys = Object.keys(value)
  if (keys.length === 1) {
    const [key] = keys
    if (key === '$oid' || key === '$numberDecimal' || key === '$numberLong') {
      return String(value[key])
    }
    if (key === '$date') return plainDateText(value.$date)
  }
  return JSON.stringify(value)
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
