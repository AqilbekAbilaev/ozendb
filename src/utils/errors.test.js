import { describe, it, expect } from 'vitest'
import { errMessage, errCode, errText } from './errors'

describe('errMessage', () => {
  it('returns the string as-is', () => {
    expect(errMessage('boom')).toBe('boom')
  })
  it('reads .message off an object', () => {
    expect(errMessage({ message: 'nope', code: 'auth' })).toBe('nope')
  })
  it('handles null', () => {
    expect(errMessage(null)).toBe('Unknown error')
  })
})

describe('errCode', () => {
  it('reads the code off a structured error', () => {
    expect(errCode({ code: 'network', message: '...' })).toBe('network')
  })
  it('returns null for a plain string', () => {
    expect(errCode('boom')).toBe(null)
  })
})

describe('errText', () => {
  it('replaces the raw driver dump with a friendly title for network errors', () => {
    const e = { code: 'network', message: 'Server selection timeout … Topology: { ... }' }
    expect(errText(e)).toBe("Can't reach the server")
  })
  it('uses the friendly title for generic (topology/command) mongo errors', () => {
    const e = { code: 'mongo', message: 'some verbose driver dump …' }
    expect(errText(e)).toBe('The database reported an error')
  })
  it('uses the friendly title for generic postgres errors', () => {
    const e = { code: 'postgres', message: 'some verbose sqlx driver dump …' }
    expect(errText(e)).toBe('The database reported an error')
  })
  it('surfaces the server message directly for write errors (e.g. duplicate key)', () => {
    // The backend humanizes write/insert failures and tags them `write` (no friendly
    // title), so the actionable message reaches the user instead of "database error".
    const e = { code: 'write', message: 'E11000 duplicate key error … dup key: { _id: 5 }' }
    expect(errText(e)).toBe('E11000 duplicate key error … dup key: { _id: 5 }')
  })
  it('falls back to the raw message for self-authored codes with no title', () => {
    const e = { code: 'validation', message: 'Filter must be valid JSON' }
    expect(errText(e)).toBe('Filter must be valid JSON')
  })
  it('falls back to the raw message when there is no code', () => {
    expect(errText('boom')).toBe('boom')
  })
})
