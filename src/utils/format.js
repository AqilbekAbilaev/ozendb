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
