// Updater capability probe.

import { invoke } from '@tauri-apps/api/core'

export function canSelfUpdate() {
  return invoke('can_self_update')
}