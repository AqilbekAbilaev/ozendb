// Syncing this device with the OzenDB server. `syncNow()` asks for a sync and answers at
// once; how it went arrives as a `sync-status` event (onSyncStatus in events.js).
// `getSyncStatus()` answers the latest such status, or `null` before the first: `{ status:
// 'running' | 'synced' | 'failed', error: { code, message } | null, received_only,
// keychain_error: { code, message } | null, time, last_synced }`, with `time` and
// `last_synced` (null when this device never synced) in epoch milliseconds.

import { invoke } from '@tauri-apps/api/core'

export function syncNow() {
  return invoke('sync_now')
}

export function getSyncStatus() {
  return invoke('sync_status')
}
