// What the sync status indicator shows for the latest sync status (appApi/sync.js) and the
// Premium entitlement's state: `null` when it is hidden, else `{ tone, spinning, label,
// detail, warning, lastSynced }`. `tone` is 'ok', 'muted' or 'error'; `label` is the one
// line the tooltip shows; the rest is for the popover and may be ''.
export function syncView(status, entitlementState, now) {
  // Only an account that has, or had, Premium syncs at all.
  if (entitlementState !== 'premium' && entitlementState !== 'expired') return null
  if (status == null) return view('ok', 'Not synced yet')
  const lastSynced = lastSyncedText(status.last_synced, now)
  switch (status.status) {
    case 'running':
      return { ...view('ok', 'Syncing…'), spinning: true, lastSynced }
    case 'synced':
      if (status.received_only) return { ...view('muted', 'Receiving only', LAPSED), lastSynced }
      return {
        ...view('ok', `Synced ${ago(status.last_synced ?? status.time, now)}`),
        warning: keychainWarning(status.keychain_error),
      }
    default:
      return { ...failure(status.error), lastSynced }
  }
}

const LAPSED = 'Premium has lapsed. Changes from your other devices still arrive, but edits made here are not uploaded.'
const KEYCHAIN_REFUSED = 'A saved password could not be stored in the keychain. The next sync tries again.'
const NO_KEYRING = 'Passwords are not synced: no keyring service was found.'

function keychainWarning(error) {
  if (!error) return ''
  return error.code === 'keychain_unavailable' ? NO_KEYRING : KEYCHAIN_REFUSED
}

// Codes with wording of their own; any other shows the backend's message.
const FAILURES = {
  unreachable:       ['muted', 'Offline', 'Could not reach the sync server. OzenDB tries again while edits made here are waiting to be sent.'],
  sync_rate_limited: ['muted', 'Sync paused', 'The sync server asked OzenDB to wait. Try again in a couple of minutes.'],
  signed_out:        ['muted', 'Signed out', 'Sign in again in Account settings to keep syncing.'],
  sync_not_set_up:   ['muted', 'Sync not set up', 'Set up sync in Account settings to start syncing.'],
  not_premium:       ['muted', 'Premium needed', 'Syncing needs Premium. Account settings show your plan.'],
  newer_sync_format: ['error', 'Update needed', 'Another device synced with a newer version of OzenDB. Update OzenDB to keep syncing.'],
}

function failure(error) {
  const known = FAILURES[error?.code]
  if (known) return view(...known)
  return view('error', 'Sync failed', error?.message ?? '')
}

function view(tone, label, detail = '') {
  return { tone, spinning: false, label, detail, warning: '', lastSynced: '' }
}

function lastSyncedText(lastSynced, now) {
  return lastSynced == null ? 'This device has not synced yet.' : `Last synced ${ago(lastSynced, now)}.`
}

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// How long ago `then` was, as words that follow "Synced": "just now", "5 minutes ago",
// "2 hours ago", or "on 3 Oct 2026" once it is a day or more. A clock that moved back
// reads as "just now".
export function ago(then, now) {
  const elapsed = now - then
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) return count(Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return count(Math.floor(elapsed / HOUR), 'hour')
  return `on ${new Date(then).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

function count(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`
}
