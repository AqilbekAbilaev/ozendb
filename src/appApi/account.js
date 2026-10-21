// The OzenDB account on this device. `getEntitlement` reports what the server last said
// about Premium: `{ state: 'unknown' | 'free' | 'expired' }` or
// `{ state: 'premium', until }`, with `until` in epoch milliseconds. `getAccount` answers
// `null` when signed out, else `{ email, subscription: { status, renews_at, ends_at } }`
// as the server last described it (both null until it has; times in epoch milliseconds).
//
// Signing in: `startSignIn(email)` emails a link and answers `{ request, code }`. Show the
// code, then call `pollSignIn(request)` 3 seconds after each answer (setTimeout, never two
// at once: a second call after the first picked up the session reads as expired) until it
// answers `{ state: 'signed_in' }`. The server allows 60 polls a minute per address, so on
// `account_rate_limited` wait 60 seconds; on `sign_in_expired` stop. After signing in or
// out, call `refreshPremium()` so the UI shows the new answer.

import { invoke } from '@tauri-apps/api/core'

export function getEntitlement() {
  return invoke('get_entitlement')
}

export function getAccount() {
  return invoke('get_account')
}

export function startSignIn(email) {
  return invoke('start_sign_in', { email })
}

export function pollSignIn(request) {
  return invoke('poll_sign_in', { request })
}

export function signOut() {
  return invoke('sign_out')
}
