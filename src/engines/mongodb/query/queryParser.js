// Parse MongoDB shell syntax (the same dialect Compass / Studio-3T accept) into
// canonical Extended JSON for the Rust backend, which already decodes EJSON into BSON.
// This replaces the old regex passes (toStrictJson / expandShellTypes / …), which could
// corrupt string values because a regex has no concept of "inside a string".
import { parse, ParseMode } from '@mongodb-js/shell-bson-parser'
import { EJSON } from 'bson'

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/

// macOS "Smart Quotes" inserts curly quotes the JS parser can't read; straighten them
// here (once, at parse time) rather than mutating the field on every keystroke.
function normalizeQuotes(str) {
  return str.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
}

// The parser throws errors like `Unexpected token (2:5) in (\n<source>\n)`; keep the
// human part (message + position), drop the echoed source.
function cleanError(e) {
  const msg = e && e.message ? e.message : String(e)
  return msg.split(/\s+in\s+\(/)[0].trim()
}

// Parse one query field (filter / projection / sort). Empty or {} is the identity.
// A bare 24-hex id is treated as { _id: ObjectId(id) } so you can paste an id straight
// in. Returns { ok, ejson, error }.
export function parseField(raw) {
  const s = normalizeQuotes((raw || '').trim())
  if (s === '' || s === '{}') {
    return { ok: true, ejson: '{}', error: null }
  }
  const source = OBJECT_ID_RE.test(s) ? `{ _id: ObjectId("${s}") }` : s
  try {
    const parsed = parse(source, { mode: ParseMode.Loose, allowMethods: true })
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, ejson: null, error: 'Expected a document, e.g. { field: value }' }
    }
    return { ok: true, ejson: EJSON.stringify(parsed, null, 0, { relaxed: false }), error: null }
  } catch (e) {
    return { ok: false, ejson: null, error: cleanError(e) }
  }
}

// Parse an aggregation pipeline (a JSON/shell array of stage objects). Empty or [] is
// the identity. Returns { ok, ejson, error }.
export function parsePipeline(raw) {
  const s = normalizeQuotes((raw || '').trim())
  if (s === '' || s === '[]') {
    return { ok: true, ejson: '[]', error: null }
  }
  try {
    const parsed = parse(s, { mode: ParseMode.Loose, allowMethods: true }) // handles arrays as well as documents
    if (!Array.isArray(parsed)) {
      return { ok: false, ejson: null, error: 'Pipeline must be an array of stages, e.g. [ { $match: {} } ]' }
    }
    return { ok: true, ejson: EJSON.stringify(parsed, null, 0, { relaxed: false }), error: null }
  } catch (e) {
    return { ok: false, ejson: null, error: cleanError(e) }
  }
}
