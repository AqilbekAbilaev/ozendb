// Workspace session persistence. Session snapshots are full objects saved on a
// debounce; restoration is a plain read.

import { invoke } from '@tauri-apps/api/core'

export function getOpenTabs() {
  return invoke('get_open_tabs')
}

export function setOpenTabs(session) {
  return invoke('set_open_tabs', { session })
}