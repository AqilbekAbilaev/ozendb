// Shared display formatters. These used to be copy-pasted per component, which let
// the same number render as "4.2 MB" in one panel and "4.0 MiB" in another.

// Human-readable byte size. Divides by 1024 but labels KB/MB/GB — the convention
// MongoDB's own tooling uses, so sizes here match what Compass and the shell report.
// Values of 10 and above drop the decimal ("12 KB", not "12.3 KB").
// `empty` is what to return for a missing value: callers that render conditionally
// pass null, the index pane passes 'n/a', everything else takes the em dash.
export function fmtBytes(bytes, empty = '—') {
  if (bytes == null) return empty
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`
}

// Human size followed by the exact byte count, the way Studio-3T's collection tooltip
// reports sizes — the rounded figure to read, the exact one to check against. Below 1 KB
// fmtBytes already *is* the byte count, so the parenthetical would just repeat it.
export function fmtBytesExact(bytes) {
  if (bytes == null) return '—'
  if (bytes < 1024) return fmtBytes(bytes)
  return `${fmtBytes(bytes)} (${fmtNum(bytes)})`
}

// Wall clock to the second, for "fetched at" stamps. Distinct from formatNow(), whose
// format is pinned by the connection list's `last_accessed` ordering.
export function fmtClock() {
  const now = new Date()
  const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  return `${date} ${now.toLocaleTimeString('en-GB', { hour12: false })}`
}

// One preview-table cell as text: objects are shown as compact JSON, null/undefined
// as blank. Used by the import, CSV import and export preview grids.
export function cellText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

// Thousands-separated count, em dash when the server omitted the field.
export function fmtNum(n) {
  return n == null ? '—' : Number(n).toLocaleString()
}

// Current time in the app's display format ("27 Jul 2026 14:05"). Connections store
// `last_accessed` as this string rather than an ISO timestamp, so the format has to
// match everywhere it's written or the sidebar's recency ordering breaks.
export function formatNow() {
  return new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).replace(',', '')
}
