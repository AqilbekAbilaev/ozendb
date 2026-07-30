// Customizable keyboard shortcuts.
//
// The stored/native format is the Tauri accelerator string (e.g.
// "CmdOrCtrl+Shift+L", "F4") — the single source of truth shared by the native
// menu (src-tauri/src/menu.rs) and the JS key handler in App.vue, so a rebind
// stays consistent across both. Only the ids listed here are customizable; each
// one is a menu-action id already handled by handleMenuAction.

export const SHORTCUT_COMMANDS = [
  { id: 'file:connect',      label: 'Connect…',                  group: 'File',       default: 'CmdOrCtrl+N' },
  { id: 'file:intellishell', label: 'Open IntelliShell',         group: 'File',       default: 'CmdOrCtrl+L' },
  { id: 'file:sql',          label: 'Open SQL',                  group: 'File',       default: 'CmdOrCtrl+Shift+L' },
  { id: 'edit:preferences',  label: 'Preferences…',              group: 'Edit',       default: 'CmdOrCtrl+P' },
  { id: 'coll:vqb',          label: 'Show Visual Query Builder', group: 'Collection', default: 'CmdOrCtrl+B' },
  { id: 'coll:aggregation',  label: 'Open Aggregation Editor',   group: 'Collection', default: 'F4' },
  { id: 'coll:open_tab',     label: 'Open Collection Tab',       group: 'Collection', default: 'F10' },
  { id: 'doc:edit_json',     label: 'Edit Document (JSON)…',     group: 'Document',   default: 'CmdOrCtrl+J' },
  { id: 'view:refresh',      label: 'Refresh',                   group: 'View',       default: 'CmdOrCtrl+R' },
  { id: 'view:next_tab',    label: 'Next Tab',                 group: 'View',       default: 'CmdOrCtrl+Tab' },
  { id: 'view:prev_tab',    label: 'Previous Tab',             group: 'View',       default: 'CmdOrCtrl+Shift+Tab' },
  // `=` / `-` / `0` rather than "Plus"/"Minus": those are the literal names the native
  // accelerator parser accepts *and* what `event.key` reports, so one string serves both.
  { id: 'view:zoom_in',     label: 'Zoom In',                  group: 'View',       default: 'CmdOrCtrl+=' },
  { id: 'view:zoom_out',    label: 'Zoom Out',                 group: 'View',       default: 'CmdOrCtrl+-' },
  { id: 'view:zoom_reset',  label: 'Actual Size',              group: 'View',       default: 'CmdOrCtrl+0' },
]

const DEFAULTS = Object.fromEntries(SHORTCUT_COMMANDS.map((cmd) => [cmd.id, cmd.default]))

// The built-in default accelerator for a command id (or undefined).
export function defaultAccel(id) {
  return DEFAULTS[id]
}

// Layer persisted overrides on top of the built-in defaults. Only known command
// ids survive, so a stale id in the store can't inject a phantom binding.
export function mergeBindings(overrides) {
  const merged = { ...DEFAULTS }
  if (overrides) {
    for (const cmd of SHORTCUT_COMMANDS) {
      const value = overrides[cmd.id]
      if (typeof value === 'string' && value.trim() !== '') merged[cmd.id] = value
    }
  }
  return merged
}

// Parse a Tauri accelerator string into a normalized matcher.
export function parseAccel(accel) {
  const matcher = { mod: false, shift: false, alt: false, key: '' }
  for (const raw of String(accel).split('+')) {
    const part = raw.trim()
    if (part === '') continue
    const low = part.toLowerCase()
    if (['cmdorctrl', 'cmd', 'command', 'ctrl', 'control', 'meta', 'super'].includes(low)) matcher.mod = true
    else if (low === 'shift') matcher.shift = true
    else if (low === 'alt' || low === 'option') matcher.alt = true
    else matcher.key = part
  }
  return matcher
}

// The logical key name for an event. WebKitGTK reports some keys with
// `key: "Unidentified"` (notably Shift+Tab, which arrives as ISO_Left_Tab) even
// though `code` is correct, so fall back to the physical `code` for the keys we
// bind. Only `Tab` needs mapping — letters and function keys report `key` fine.
function eventKey(event) {
  if (event.key && event.key !== 'Unidentified') return event.key
  if (event.code === 'Tab') return 'Tab'
  return event.key
}

// Does a keydown event match the accelerator? Mirrors the app convention that
// CmdOrCtrl means Ctrl (Win/Linux) or Cmd (mac): we accept ctrl OR meta.
export function eventMatchesAccel(event, accel) {
  const matcher = parseAccel(accel)
  if (matcher.key === '') return false
  const mod = event.ctrlKey || event.metaKey
  if (matcher.mod !== mod) return false
  if (matcher.shift !== event.shiftKey) return false
  if (matcher.alt !== event.altKey) return false
  return String(eventKey(event)).toLowerCase() === matcher.key.toLowerCase()
}

// Given a keydown event and merged bindings, return the id of the command whose
// accelerator it matches, or null. First match wins.
export function matchBinding(event, bindings) {
  for (const cmd of SHORTCUT_COMMANDS) {
    const accel = bindings[cmd.id]
    if (accel && eventMatchesAccel(event, accel)) return cmd.id
  }
  return null
}

// Display tokens for an accelerator, platform-aware (⌘/⇧/⌥ on mac).
export function accelToTokens(accel, isMac) {
  const tokens = []
  for (const raw of String(accel).split('+')) {
    const part = raw.trim()
    if (part === '') continue
    const low = part.toLowerCase()
    if (low === 'cmdorctrl') tokens.push(isMac ? '⌘' : 'Ctrl')
    else if (low === 'shift') tokens.push(isMac ? '⇧' : 'Shift')
    else if (low === 'alt') tokens.push(isMac ? '⌥' : 'Alt')
    else tokens.push(part.length === 1 ? part.toUpperCase() : part)
  }
  return tokens
}

// Capture a keydown into a Tauri accelerator string, or null if it isn't a
// usable global shortcut. Requires either a modifier or a function key — a bare
// letter would fire while typing. Used by the "press a key" capture field.
export function accelFromEvent(event) {
  // Use the same code fallback as the matcher so Shift+Tab (which WebKitGTK
  // reports as key "Unidentified"/ISO_Left_Tab) is captured, not dropped.
  const key = eventKey(event)
  if (['Control', 'Shift', 'Alt', 'Meta', 'Super', 'CapsLock', 'Dead', 'Unidentified'].includes(key)) return null

  let main
  if (/^F\d{1,2}$/i.test(key)) main = key.toUpperCase()
  else if (key === ' ') main = 'Space'
  else if (key.length === 1) main = key.toUpperCase()
  else main = key // Enter, Tab, ArrowUp, Escape, …

  const isFunctionKey = /^F\d{1,2}$/.test(main)
  const tokens = []
  if (event.ctrlKey || event.metaKey) tokens.push('CmdOrCtrl')
  if (event.shiftKey) tokens.push('Shift')
  if (event.altKey) tokens.push('Alt')
  if (tokens.length === 0 && !isFunctionKey) return null

  tokens.push(main)
  return tokens.join('+')
}
