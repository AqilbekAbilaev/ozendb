// The label/value pairs a stats hover card shows, per kind of row hovered. Pure, so
// the numbers each engine reports are pinned by a spec rather than by reading a card.
// MongoDB's collStats is normalized into snake_case by its Rust command while dbStats
// is passed through raw, so those two disagree on purpose; PostgreSQL's are camelCase
// like every other command of its own.
import { fmtBytes, fmtBytesExact, fmtNum } from './format'

// Postgres hands timestamps over as text (they are shown, never computed with), so the
// seconds and the offset are trimmed off what is already a readable string.
export function fmtStatsTime(value) {
  if (!value) return 'never'
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(value)
  return match ? `${match[1]} ${match[2]}` : value
}

// An index nobody has scanned is the thing worth noticing, so it says so in words
// rather than leaving a 0 to be read as a missing number.
function indexRow(index) {
  const scans = index.scans > 0 ? `${fmtNum(index.scans)} scans` : 'never used'
  return [index.name, `${fmtBytes(index.sizeBytes)} · ${scans}`]
}

export function statsRows(kind, stats) {
  if (!stats) return []
  if (kind === 'database') {
    return [
      ['Collections',  fmtNum(stats.collections)],
      ['Objects',      fmtNum(stats.objects)],
      ['Data Size',    fmtBytesExact(stats.dataSize)],
      ['Storage Size', fmtBytesExact(stats.storageSize)],
      ['Avg Object',   fmtBytes(stats.avgObjSize)],
      ['Indexes',      fmtNum(stats.indexes)],
      ['Index Size',   fmtBytesExact(stats.indexSize)],
    ]
  }
  if (kind === 'pgTable') {
    return [
      ['Rows (est.)',  stats.estimatedRows == null ? '—' : fmtNum(stats.estimatedRows)],
      ['Total Size',   fmtBytesExact(stats.totalSizeBytes)],
      ['Table Size',   fmtBytesExact(stats.tableSizeBytes)],
      ['Index Size',   fmtBytesExact(stats.indexesSizeBytes)],
      ['Dead Rows',    fmtNum(stats.deadRows)],
      ['Last Vacuum',  fmtStatsTime(stats.lastVacuum)],
      ['Last Analyze', fmtStatsTime(stats.lastAnalyze)],
      ...(stats.indexes ?? []).map(indexRow),
    ]
  }
  return [
    ['Count',            fmtNum(stats.count)],
    ['Size',             fmtBytesExact(stats.size)],
    ['Storage Size',     fmtBytesExact(stats.storage_size)],
    ['Avg Document',     fmtBytes(stats.avg_obj_size)],
    ['Indexes',          fmtNum(stats.nindexes)],
    ['Total Index Size', fmtBytesExact(stats.total_index_size)],
  ]
}
