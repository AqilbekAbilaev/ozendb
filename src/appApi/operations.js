// Long-running operation surface: the rail list and its clear action.

import { invoke } from '@tauri-apps/api/core'

export function listOperations() {
  return invoke('list_operations')
}

// The backend keeps running operations; only finished ones are cleared.
export function clearFinishedOperations() {
  return invoke('clear_operations')
}