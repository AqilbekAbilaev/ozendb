import { describe, it, expect } from 'vitest'
import { statsRows, fmtStatsTime } from './statsRows'

describe('fmtStatsTime', () => {
  it('trims a Postgres timestamp to the minute', () => {
    expect(fmtStatsTime('2026-09-30 12:34:56.789123+00')).toBe('2026-09-30 12:34')
  })

  it('says never rather than showing a blank', () => {
    expect(fmtStatsTime(null)).toBe('never')
    expect(fmtStatsTime(undefined)).toBe('never')
  })

  it('leaves a value it does not recognise alone', () => {
    expect(fmtStatsTime('sometime')).toBe('sometime')
  })
})

describe('statsRows', () => {
  it('is empty without stats, whatever the kind', () => {
    expect(statsRows('collection', null)).toEqual([])
    expect(statsRows('pgTable', undefined)).toEqual([])
  })

  it('reads a MongoDB database\'s camelCase fields', () => {
    const rows = statsRows('database', {
      collections: 3, objects: 1200, dataSize: 2048, storageSize: 4096,
      avgObjSize: 170, indexes: 5, indexSize: 1024,
    })
    expect(rows).toContainEqual(['Collections', '3'])
    expect(rows.map(([label]) => label)).toEqual([
      'Collections', 'Objects', 'Data Size', 'Storage Size', 'Avg Object', 'Indexes', 'Index Size',
    ])
  })

  it('reads a MongoDB collection\'s snake_case fields', () => {
    const rows = statsRows('collection', {
      count: 7, size: 512, storage_size: 1024, avg_obj_size: 73,
      nindexes: 2, total_index_size: 256,
    })
    expect(rows).toContainEqual(['Count', '7'])
    expect(rows).toContainEqual(['Indexes', '2'])
  })

  const table = {
    totalSizeBytes: 5_242_880,
    tableSizeBytes: 3_145_728,
    indexesSizeBytes: 2_097_152,
    estimatedRows: 1002,
    deadRows: 40,
    lastVacuum: null,
    lastAnalyze: '2026-09-30 12:34:56.789123+00',
    indexes: [
      { name: 'users_pkey', sizeBytes: 1_048_576, scans: 900, primaryKey: true },
      { name: 'users_email_idx', sizeBytes: 1_048_576, scans: 0, primaryKey: false },
    ],
  }

  it('reports a table\'s sizes, estimate and bloat signals', () => {
    const rows = statsRows('pgTable', table)
    expect(rows).toContainEqual(['Rows (est.)', '1,002'])
    expect(rows).toContainEqual(['Dead Rows', '40'])
    expect(rows).toContainEqual(['Last Vacuum', 'never'])
    expect(rows).toContainEqual(['Last Analyze', '2026-09-30 12:34'])
  })

  it('lists every index with its size and scan count', () => {
    const rows = statsRows('pgTable', table)
    const pk = rows.find(([label]) => label === 'users_pkey')
    expect(pk[1]).toContain('900 scans')
    // An index nothing has used is the signal worth seeing, so it says so in words.
    const unused = rows.find(([label]) => label === 'users_email_idx')
    expect(unused[1]).toContain('never used')
  })

  it('does not invent a row estimate the server did not give', () => {
    const rows = statsRows('pgTable', { ...table, estimatedRows: null })
    expect(rows).toContainEqual(['Rows (est.)', '—'])
  })

  it('has no index rows when a table has none', () => {
    const rows = statsRows('pgTable', { ...table, indexes: [] })
    expect(rows.every(([label]) => !label.includes('idx'))).toBe(true)
  })
})
