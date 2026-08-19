// Native menu selection context. Pushed on every selection change so gated menu
// items enable/disable in step with the sidebar selection and active tab.

import { invoke } from '@tauri-apps/api/core'

export function setMenuContext(context) {
  return invoke('set_menu_context', context)
}