import { describe, expect, it } from 'vitest'
import { MAX_SYNC_PASSWORD, syncPasswordProblem } from './syncPassword'

const PASSWORD = 'correct horse/battery.staple — ünïcödé'

describe('syncPasswordProblem', () => {
  it('accepts a long enough password typed the same twice', () => {
    expect(syncPasswordProblem(PASSWORD, PASSWORD)).toBe('')
  })

  it('accepts twelve characters with spaces and accents', () => {
    expect(syncPasswordProblem('pässwörd 12/', 'pässwörd 12/')).toBe('')
  })

  it('counts an accent typed apart from its letter as one character', () => {
    const short = 'é'.repeat(6)
    expect(syncPasswordProblem(short, short)).toBe('Use at least 12 characters.')
  })

  it('refuses a password longer than the limit', () => {
    const long = 'ü'.repeat(MAX_SYNC_PASSWORD + 1)
    expect(syncPasswordProblem(long, long)).toBe('Use at most 256 characters.')
  })

  it('refuses a confirmation that differs', () => {
    expect(syncPasswordProblem(PASSWORD, `${PASSWORD} `)).toBe('The two passwords do not match.')
  })
})
