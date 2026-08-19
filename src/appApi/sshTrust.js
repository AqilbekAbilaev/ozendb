// SSH tunnel host-key verification. Trust-on-first-use prompts flow through the
// frontend; these commands answer them or forget a remembered host.

import { invoke } from '@tauri-apps/api/core'

export function respondSshHostKey(requestId, trust) {
  return invoke('respond_ssh_host_key', { requestId, trust })
}

export function forgetSshHost(host, port) {
  return invoke('forget_ssh_host', { host, port })
}