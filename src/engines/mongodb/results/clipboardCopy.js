// Pure serialization helpers for the Edit-menu clipboard copies (Copy, Copy Value,
// Copy Document, Copy Field Path) and the grid's inline cell-copy affordances.
// Extracted so the value/EJSON serialization is unit-tested (see clipboardCopy.test.js)
// and shared between the native menu and the result grid, keeping every "copy" in the
// app consistent. The values these receive are the Extended-JSON-shaped plain objects
// the result grid holds (e.g. { $oid: "…" }, { $date: { $numberLong: "…" } }).

// Serialize a single field value the "shell" way, mirroring the result grid's inline
// Copy Value: primitives copy as their bare text; the common Extended-JSON wrappers
// (ObjectId, Date, NumberLong/Decimal) copy as the underlying scalar; anything else
// (nested objects/arrays) copies as pretty Extended JSON.
export function valueToClipboard(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    if ('$oid' in value) return value.$oid
    if ('$date' in value) {
      const d = value.$date
      if (typeof d === 'string') return d
      if (d && typeof d === 'object' && '$numberLong' in d) {
        return new Date(parseInt(d.$numberLong)).toISOString()
      }
    }
    if ('$numberLong' in value) return value.$numberLong
    if ('$numberDecimal' in value) return value.$numberDecimal
  }
  return JSON.stringify(value, null, 2)
}

// Serialize a single field value as valid Extended JSON (the Edit menu's "Copy Value").
// Primitives copy bare (a string field yields its text, not a quoted JSON string);
// everything non-primitive — including the EJSON wrappers for ObjectId/Date/etc. and
// nested objects/arrays — copies as canonical Extended JSON that round-trips back to
// the same BSON type.
export function valueToEjson(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

// Serialize an entire document for the clipboard as pretty Extended JSON.
export function documentToClipboard(doc) {
  return JSON.stringify(doc, null, 2)
}

// The dotted path to a field within a document, honoring the drilled-into path.
// e.g. drillPath ['address'], field 'city' → 'address.city'; drillPath [] → 'city'.
export function fieldPath(drillPath, field) {
  return [...(drillPath || []), field]
    .filter((seg) => seg != null && seg !== '')
    .join('.')
}
