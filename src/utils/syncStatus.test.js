import { describe, it, expect } from 'vitest'
import { syncView, ago } from './syncStatus'

// Midday UTC, so a date reads the same in any time zone the tests run in.
const NOW = Date.UTC(2026, 9, 21, 12)
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

function status(fields) {
  return { status: 'synced', error: null, received_only: false, keychain_error: null, time: NOW, last_synced: NOW, ...fields }
}

function failed(code, message) {
  return status({ status: 'failed', error: { code, message }, last_synced: NOW - 2 * HOUR })
}

describe('syncView: when it shows', () => {
  it('hides when signed out, whatever the last status said', () => {
    expect(syncView(failed('signed_out', 'You are signed out.'), 'unknown', NOW)).toBeNull()
  })

  it('hides on the free plan', () => {
    expect(syncView(failed('not_premium', 'Syncing needs Premium.'), 'free', NOW)).toBeNull()
  })

  it('shows for a lapsed account, which still receives', () => {
    expect(syncView(status({ received_only: true }), 'expired', NOW).label).toBe('Receiving only')
  })

  it('says nothing has synced yet before the first status arrives', () => {
    expect(syncView(null, 'premium', NOW)).toMatchObject({ tone: 'ok', label: 'Not synced yet' })
  })
})

describe('syncView: states', () => {
  it('spins while a sync runs', () => {
    expect(syncView(status({ status: 'running' }), 'premium', NOW)).toMatchObject({ spinning: true, label: 'Syncing…' })
  })

  it('says when this device last synced', () => {
    expect(syncView(status({ last_synced: NOW - 3 * MINUTE }), 'premium', NOW).label).toBe('Synced 3 minutes ago')
  })

  it('warns when the keychain refused a saved password', () => {
    const view = syncView(status({ keychain_error: { code: 'keychain', message: 'Keychain "Ozen DB/ü" refused the write.' } }), 'premium', NOW)
    expect(view.warning).toMatch(/could not be stored in the keychain/)
  })

  it('explains that a lapsed account only receives, in a muted tone', () => {
    expect(syncView(status({ received_only: true }), 'expired', NOW)).toMatchObject({ tone: 'muted', detail: expect.stringMatching(/not uploaded/) })
  })

  it('calls an unreachable server offline and says when it last synced', () => {
    expect(syncView(failed('unreachable', 'Could not reach api.ozendb.com.'), 'premium', NOW))
      .toMatchObject({ tone: 'muted', label: 'Offline', lastSynced: 'Last synced 2 hours ago.' })
  })

  it('asks to wait when the server limits syncs', () => {
    expect(syncView(failed('sync_rate_limited', 'Too many syncs.'), 'premium', NOW).label).toBe('Sync paused')
  })

  it('points a device that is not set up to Account settings', () => {
    expect(syncView(failed('sync_not_set_up', 'Sync is not set up.'), 'premium', NOW).detail).toMatch(/Account settings/)
  })

  it('asks for an update when another device used a newer format', () => {
    expect(syncView(failed('newer_sync_format', 'Newer format.'), 'premium', NOW)).toMatchObject({ tone: 'error', label: 'Update needed' })
  })

  it("shows the backend's message for any other failure", () => {
    expect(syncView(failed('sync_server', 'The sync server answered 503 for "a/b.c".'), 'premium', NOW))
      .toMatchObject({ tone: 'error', label: 'Sync failed', detail: 'The sync server answered 503 for "a/b.c".' })
  })

  it('says a device that never synced has not synced yet', () => {
    expect(syncView(status({ status: 'failed', error: { code: 'unreachable', message: '' }, last_synced: null }), 'premium', NOW).lastSynced)
      .toBe('This device has not synced yet.')
  })
})

describe('ago', () => {
  it('says just now under a minute', () => {
    expect(ago(NOW - 59 * 1000, NOW)).toBe('just now')
  })

  it('says just now when the clock moved back', () => {
    expect(ago(NOW + 5 * MINUTE, NOW)).toBe('just now')
  })

  it('counts a single minute without a plural', () => {
    expect(ago(NOW - MINUTE, NOW)).toBe('1 minute ago')
  })

  it('counts hours from the first hour', () => {
    expect(ago(NOW - HOUR, NOW)).toBe('1 hour ago')
  })

  it('gives the date once it is a day or more', () => {
    expect(ago(NOW - 24 * HOUR, NOW)).toBe('on 20 Oct 2026')
  })
})
