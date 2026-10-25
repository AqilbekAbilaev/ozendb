import { describe, it, expect } from 'vitest'
import { fmtUptime, summaryCards, serverBanner, matchValues } from './serverInfoRows'

const values = (pairs) => Object.entries(pairs).map(([name, value]) => ({ name, value }))
const INFO = {
  variables: values({ version: '8.4.13', version_comment: 'MySQL Community Server - GPL', max_connections: '151' }),
  status: values({ Uptime: '93784', Threads_connected: '12', Threads_running: '2', Questions: '1234567', Slow_queries: '0' }),
}

describe('fmtUptime', () => {
  it('counts days, hours and minutes', () => {
    expect(fmtUptime('93784')).toBe('1d 2h 3m')
  })

  it('keeps the hours once there are days, even at none', () => {
    expect(fmtUptime(String(86400 + 60))).toBe('1d 0h 1m')
  })

  it('says a just-started server has been up for less than a minute', () => {
    expect(fmtUptime('59')).toBe('less than a minute')
  })

  it('has nothing to say without a reading', () => {
    expect(fmtUptime(undefined)).toBe('—')
  })
})

describe('summaryCards', () => {
  it('picks the summary out of the variables and status', () => {
    expect(summaryCards(INFO).map(card => [card.label, card.value])).toEqual([
      ['Version', '8.4.13'],
      ['Uptime', '1d 2h 3m'],
      ['Connections', '12 of 151'],
      ['Running threads', '2'],
      ['Queries', '1,234,567'],
      ['Slow queries', '0'],
    ])
  })

  it('shows nothing before the server has answered', () => {
    expect(summaryCards(null)).toEqual([])
  })
})

describe('serverBanner', () => {
  it('says which build the server is', () => {
    expect([serverBanner(INFO), serverBanner(null)]).toEqual(['MySQL Community Server - GPL', undefined])
  })
})

describe('matchValues', () => {
  it('finds a value by its name or what it is set to, ignoring case', () => {
    expect(matchValues(INFO.variables, 'MAX_CONN').map(v => v.name)).toEqual(['max_connections'])
    expect(matchValues(INFO.variables, 'community').map(v => v.name)).toEqual(['version_comment'])
  })

  it('keeps everything for an empty search', () => {
    expect(matchValues(INFO.status, '  ')).toHaveLength(5)
  })
})
