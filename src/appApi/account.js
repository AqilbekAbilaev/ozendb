// The OzenDB account on this device. `getEntitlement` reports what the server last said
// about Premium: `{ state: 'unknown' | 'free' | 'expired' }` or
// `{ state: 'premium', until }`, with `until` in epoch milliseconds.

import { invoke } from '@tauri-apps/api/core'

export function getEntitlement() {
  return invoke('get_entitlement')
}
