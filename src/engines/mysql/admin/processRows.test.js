import { describe, it, expect } from 'vitest'
import { queryText, fmtSeconds, processOptions, matchProcesses } from './processRows'

const PROCESSES = [
  { id: 9, user: 'app ü', database: 'shop `eu`', command: 'Query', idle: false, seconds: 75, query: 'SELECT SLEEP(90)', isSelf: false },
  { id: 5, user: 'event_scheduler', database: null, command: 'Daemon', idle: true, seconds: 51332, query: null, isSelf: false },
  { id: 7, user: 'root', database: null, command: 'Sleep', idle: true, seconds: 3, query: null, isSelf: true },
]

describe('queryText', () => {
  it('shows the statement, or a dash for a connection running none', () => {
    expect(queryText(PROCESSES[0])).toBe('SELECT SLEEP(90)')
    expect(queryText(PROCESSES[2])).toBe('—')
  })
})

describe('fmtSeconds', () => {
  it('counts seconds, then minutes, then hours', () => {
    expect([fmtSeconds(3), fmtSeconds(75), fmtSeconds(51332)]).toEqual(['3s', '1m 15s', '14h 15m'])
  })

  it('has nothing to say without a time', () => {
    expect(fmtSeconds(null)).toBe('—')
  })
})

describe('processOptions', () => {
  it('offers the users, databases and commands on the server right now', () => {
    expect(processOptions(PROCESSES)).toEqual({
      users: ['app ü', 'event_scheduler', 'root'],
      databases: ['shop `eu`'],
      commands: ['Daemon', 'Query', 'Sleep'],
    })
  })
})

describe('matchProcesses', () => {
  it('keeps what every chosen filter allows', () => {
    expect(matchProcesses(PROCESSES, { user: 'root', database: '', command: '', activeOnly: false }).map(p => p.id)).toEqual([7])
    expect(matchProcesses(PROCESSES, { user: '', database: 'shop `eu`', command: 'Query', activeOnly: false }).map(p => p.id)).toEqual([9])
  })

  it('leaves idle connections and MySQL\'s daemons out when only active ones are wanted', () => {
    expect(matchProcesses(PROCESSES, { user: '', database: '', command: '', activeOnly: true }).map(p => p.id)).toEqual([9])
  })
})
