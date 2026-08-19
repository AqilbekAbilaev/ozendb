import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Every engine-neutral Tauri command, grouped by the appApi module that owns it.
// This list is the single source of truth for the boundary: a command named here
// may only be invoked from inside src/appApi/.
const APP_COMMANDS = [
  // settings.js
  'get_settings', 'update_settings', 'get_keybindings', 'update_keybindings',
  // session.js
  'get_open_tabs', 'set_open_tabs',
  // menu.js
  'set_menu_context',
  // errorLog.js
  'list_error_log', 'clear_error_log', 'error_report_context', 'record_frontend_error',
  // operations.js
  'list_operations', 'clear_operations',
  // folders.js
  'list_folders', 'create_folder', 'rename_folder', 'delete_folder',
  'move_connection_to_folder',
  // tags.js
  'get_node_tags', 'set_node_tag', 'clear_node_tags_under', 'set_connection_tag',
  // connectionState.js
  'set_connection_open', 'update_last_accessed',
  // sshTrust.js
  'respond_ssh_host_key', 'forget_ssh_host',
  // files.js
  'stage_import_text', 'read_shell_script', 'write_shell_script',
  // updater.js
  'can_self_update',
]

// Roots where custom commands and the Tauri transport are allowed: the application
// API boundary and every engine API boundary.
function isAllowedRoot(file) {
  return file.includes('/src/appApi/') || file.includes('/src/engines/') && file.includes('/api/')
}

function isProductionFile(file) {
  return !file.endsWith('.test.js')
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, files)
    } else if (full.endsWith('.js') || full.endsWith('.vue')) {
      files.push(full)
    }
  }
  return files
}

const ALL_SOURCES = walk(join(process.cwd(), 'src'))
const PRODUCTION = ALL_SOURCES.filter(isProductionFile)

describe('Application API boundary', () => {
  it('never invokes an application command outside src/appApi/', () => {
    const offenders = []
    for (const file of ALL_SOURCES) {
      if (file.includes('/src/appApi/')) continue
      const source = readFileSync(file, 'utf8')
      for (const command of APP_COMMANDS) {
        if (source.includes(`invoke('${command}'`)) {
          offenders.push(`${file.replace(process.cwd() + '/', '')}: invoke('${command}')`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('never imports the Tauri transport in production code outside the API roots', () => {
    const offenders = []
    for (const file of PRODUCTION) {
      if (isAllowedRoot(file)) continue
      const source = readFileSync(file, 'utf8')
      if (source.includes("from '@tauri-apps/api/core'")) {
        offenders.push(file.replace(process.cwd() + '/', ''))
      }
    }
    expect(offenders).toEqual([])
  })

  it('never calls invoke in production code outside the API roots', () => {
    const offenders = []
    for (const file of PRODUCTION) {
      if (isAllowedRoot(file)) continue
      const source = readFileSync(file, 'utf8')
      if (/\binvoke\s*\(/.test(source)) {
        offenders.push(file.replace(process.cwd() + '/', ''))
      }
    }
    expect(offenders).toEqual([])
  })
})