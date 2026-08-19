// App settings and keyboard bindings, backed by the settings store. `updateSettings`
// takes a partial patch — only the keys present are written.

import { invoke } from '@tauri-apps/api/core'

export function getSettings() {
  return invoke('get_settings')
}

export function updateSettings(patch) {
  return invoke('update_settings', patch)
}

export function getKeybindings() {
  return invoke('get_keybindings')
}

export function updateKeybindings(bindings) {
  return invoke('update_keybindings', { bindings })
}