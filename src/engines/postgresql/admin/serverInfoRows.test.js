import { describe, it, expect } from 'vitest'
import { summaryCards, matchSettings, fmtUptime } from './serverInfoRows'

const INFO = {
  version: 'PostgreSQL 16.9 (Debian 16.9-1.pgdg120+1) on x86_64-pc-linux-gnu',
  serverVersion: '16.9',
  serverVersionNum: 160009,
  startedAt: '2026-09-29 08:00:00+00',
  database: 'postgres',
  databaseSizeBytes: 12_582_912,
  connections: 4,
  maxConnections: 100,
  extensions: [{ name: 'plpgsql', version: '1.0', schema: 'pg_catalog' }],
}

describe('fmtUptime', () => {
  const now = new Date('2026-09-30T12:30:00Z')

  it('counts days, hours and minutes from the start time', () => {
    expect(fmtUptime('2026-09-29 08:00:00+00', now)).toBe('1d 4h 30m')
  })

  it('drops the day when there isn\'t one', () => {
    expect(fmtUptime('2026-09-30 10:00:00+00', now)).toBe('2h 30m')
  })

  it('drops the hour too, for a server just started', () => {
    expect(fmtUptime('2026-09-30 12:29:00+00', now)).toBe('1m')
  })

  it('says less than a minute rather than 0m', () => {
    expect(fmtUptime('2026-09-30 12:29:59+00', now)).toBe('less than a minute')
  })

  it('has nothing to say without a start time', () => {
    expect(fmtUptime(null, now)).toBe('—')
  })

  it('refuses to report a negative uptime from a clock that disagrees', () => {
    expect(fmtUptime('2026-10-01 00:00:00+00', now)).toBe('—')
  })
})

describe('summaryCards', () => {
  it('is empty without info', () => {
    expect(summaryCards(null)).toEqual([])
  })

  it('leads with the version, uptime and size the acceptance asks for', () => {
    const labels = summaryCards(INFO, new Date('2026-09-30T12:30:00Z')).map(c => c.label)
    expect(labels.slice(0, 4)).toEqual(['Version', 'Uptime', 'Database', 'Database Size'])
  })

  it('shows connections against the server\'s limit', () => {
    const cards = summaryCards(INFO, new Date('2026-09-30T12:30:00Z'))
    expect(cards.find(c => c.label === 'Connections').value).toBe('4 of 100')
  })
})

describe('matchSettings', () => {
  const settings = [
    { name: 'max_connections', setting: '100', shortDesc: 'Sets the maximum number of concurrent connections.' },
    { name: 'shared_buffers', setting: '16384', shortDesc: 'Sets the number of shared memory buffers used by the server.' },
    { name: 'work_mem', setting: '4096', shortDesc: 'Sets the maximum memory to be used for query workspaces.' },
  ]

  it('returns everything for an empty search', () => {
    expect(matchSettings(settings, '')).toHaveLength(3)
    expect(matchSettings(settings, '   ')).toHaveLength(3)
  })

  it('matches on the name, whatever the case', () => {
    expect(matchSettings(settings, 'MAX_CONN').map(s => s.name)).toEqual(['max_connections'])
  })

  it('matches on the description too, so a setting is findable by what it does', () => {
    expect(matchSettings(settings, 'shared memory').map(s => s.name)).toEqual(['shared_buffers'])
  })

  it('matches on the value, for finding what is set to something', () => {
    expect(matchSettings(settings, '4096').map(s => s.name)).toEqual(['work_mem'])
  })

  it('finds nothing rather than everything when nothing matches', () => {
    expect(matchSettings(settings, 'zzz')).toEqual([])
  })

  it('survives a setting with no description', () => {
    expect(matchSettings([{ name: 'a', setting: '1', shortDesc: null }], 'a')).toHaveLength(1)
  })
})
