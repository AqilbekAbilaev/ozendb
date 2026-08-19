// Generic file staging and script I/O — no Mongo involved, but the backend owns the
// filesystem, so these still cross the Tauri boundary. `stageImportText` stages a
// pasted blob to a temp file for the import wizard; the shell script commands read
// and write IntelliShell script files from the user's chosen path.

import { invoke } from '@tauri-apps/api/core'

export function stageImportText(content, format) {
  return invoke('stage_import_text', { content, format })
}

export function readShellScript(path) {
  return invoke('read_shell_script', { path })
}

export function writeShellScript(path, contents) {
  return invoke('write_shell_script', { path, contents })
}