import { ref } from 'vue'
import { getSyncStatus, syncNow as askForSync } from '../appApi/sync'
import { onSyncStatus } from '../appApi/events'

// The latest sync status the backend sent (appApi/sync.js), or null before the first.

export const syncStatus = ref(null)

// Goes up each time a sync writes other devices' changes here. What holds its own copy of
// synced data watches it and loads that data again.
export const syncedDataVersion = ref(0)

let unlisten = null

// Listens before asking, so a status sent while the answer is on its way is not lost;
// the answer then stands only if it is newer than what arrived meanwhile.
export async function startSyncStatus() {
  unlisten = await onSyncStatus((status) => {
    syncStatus.value = status
    if (status.status === 'synced' && status.changed) syncedDataVersion.value++
  })
  const latest = await getSyncStatus()
  if (latest && !(syncStatus.value?.time > latest.time)) syncStatus.value = latest
}

// How it went arrives as a status, so there is nothing to wait for here.
export function syncNow() {
  return askForSync()
}

// Module-scope state persists through HMR; tests use this to start each case clean.
export function resetSyncStatus() {
  unlisten?.()
  unlisten = null
  syncStatus.value = null
  syncedDataVersion.value = 0
}
