// Setting sync up on this device. `getSyncSetupStatus` answers `{ state: 'set_up' }`,
// `{ state: 'new' }` (the account's first device) or `{ state: 'existing', recovery }`
// (another device set it up; `recovery` says whether a recovery key can unlock it).
//
// First device: `createSyncKeys(password)` answers the recovery key to show once; after
// the user saved it, `finishSyncSetup()` uploads this device's data. On failure the
// backend keeps the keys, so calling it again shows no new recovery key.
// Another device: `unlockSyncWithPassword` or `unlockSyncWithRecoveryKey`; the first
// sync then runs on its own and reports through the `sync-status` event.
// Once set up: `changeSyncPassword(password)` locks the account's key with a new password,
// and `replaceRecoveryKey()` answers a new recovery key to show once; the old one stops working.

import { invoke } from '@tauri-apps/api/core'

export function getSyncSetupStatus() {
  return invoke('sync_setup_status')
}

export function createSyncKeys(password) {
  return invoke('create_sync_keys', { password })
}

export function finishSyncSetup() {
  return invoke('finish_sync_setup')
}

export function unlockSyncWithPassword(password) {
  return invoke('unlock_sync_with_password', { password })
}

export function unlockSyncWithRecoveryKey(recoveryKey) {
  return invoke('unlock_sync_with_recovery_key', { recoveryKey })
}

export function changeSyncPassword(password) {
  return invoke('change_sync_password', { password })
}

export function replaceRecoveryKey() {
  return invoke('replace_recovery_key')
}
