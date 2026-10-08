// The rules the GridFS browser applies (composables/useGridfsBrowser), as pure functions.
import { parseField } from './queryParser'

// The default "fs" bucket is always offered, even before it exists (an upload creates
// it), alongside every bucket the server reported.
export function bucketChoices(buckets) {
  return [...new Set([...buckets, 'fs'])].sort()
}

// The metadata a user typed, as the Extended JSON the backend stores. Empty text or an
// empty document clears the metadata, which the backend reads as an empty string.
export function metadataEjson(text) {
  const raw = text.trim()
  if (raw === '' || raw === '{}') return { ok: true, ejson: '' }
  const parsed = parseField(raw)
  return parsed.ok ? { ok: true, ejson: parsed.ejson } : { ok: false, error: parsed.error }
}

// An upload date as "YYYY-MM-DD HH:MM:SS", or a dash when the server sent none.
export function fmtUploadDate(iso) {
  if (!iso) return '—'
  return iso.replace('T', ' ').replace(/\..*$/, '')
}
