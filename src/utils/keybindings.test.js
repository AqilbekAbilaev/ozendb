import { describe, it, expect } from 'vitest'
import {
  SHORTCUT_COMMANDS,
  shortcutGroups,
  mergeBindings,
  parseAccel,
  eventMatchesAccel,
  matchBinding,
  accelToTokens,
  accelFromEvent,
} from './keybindings'

// A minimal keydown-event stand-in; only the fields the matcher reads.
function evt({ key, code = '', ctrl = false, meta = false, shift = false, alt = false }) {
  return { key: key, code: code, ctrlKey: ctrl, metaKey: meta, shiftKey: shift, altKey: alt }
}

describe('SHORTCUT_COMMANDS', () => {
  it('never ships two commands on the same default accelerator', () => {
    // Two commands on one key means whichever matchBinding reaches first wins and the
    // other silently never fires — the kind of clash only a user report would surface.
    const byAccel = {}
    for (const cmd of SHORTCUT_COMMANDS) {
      expect(byAccel[cmd.default], `${cmd.default} is already bound to ${byAccel[cmd.default]}`).toBeUndefined()
      byAccel[cmd.default] = cmd.id
    }
  })
})

describe('shortcutGroups', () => {
  it('buckets every command exactly once, keeping the table order', () => {
    const groups = shortcutGroups()
    expect(groups.map((g) => g.title)).toEqual(['File', 'Edit', 'Collection', 'Document', 'View'])
    const ids = groups.flatMap((g) => g.commands.map((c) => c.id))
    expect(ids).toHaveLength(SHORTCUT_COMMANDS.length)
    expect(new Set(ids).size).toBe(SHORTCUT_COMMANDS.length)
  })

  it('puts each command under its own group', () => {
    for (const group of shortcutGroups()) {
      for (const cmd of group.commands) expect(cmd.group).toBe(group.title)
    }
  })
})

describe('mergeBindings', () => {
  it('returns the built-in defaults when there are no overrides', () => {
    const merged = mergeBindings(null)
    expect(merged['file:connect']).toBe('CmdOrCtrl+N')
    expect(merged['coll:aggregation']).toBe('F4')
    expect(Object.keys(merged).length).toBe(SHORTCUT_COMMANDS.length)
  })

  it('layers a valid override over the default', () => {
    const merged = mergeBindings({ 'file:connect': 'CmdOrCtrl+Shift+K' })
    expect(merged['file:connect']).toBe('CmdOrCtrl+Shift+K')
  })

  it('ignores unknown ids and blank values', () => {
    const merged = mergeBindings({ 'bogus:id': 'CmdOrCtrl+X', 'view:refresh': '  ' })
    expect(merged['bogus:id']).toBeUndefined()
    expect(merged['view:refresh']).toBe('CmdOrCtrl+R')
  })
})

describe('parseAccel', () => {
  it('splits modifiers and the key', () => {
    expect(parseAccel('CmdOrCtrl+Shift+L')).toEqual({ mod: true, shift: true, alt: false, key: 'L' })
    expect(parseAccel('F4')).toEqual({ mod: false, shift: false, alt: false, key: 'F4' })
  })
})

describe('eventMatchesAccel', () => {
  it('matches Ctrl and Cmd interchangeably for CmdOrCtrl', () => {
    expect(eventMatchesAccel(evt({ key: 'n', ctrl: true }), 'CmdOrCtrl+N')).toBe(true)
    expect(eventMatchesAccel(evt({ key: 'n', meta: true }), 'CmdOrCtrl+N')).toBe(true)
  })

  it('requires the shift state to match', () => {
    expect(eventMatchesAccel(evt({ key: 'l', ctrl: true, shift: true }), 'CmdOrCtrl+Shift+L')).toBe(true)
    expect(eventMatchesAccel(evt({ key: 'l', ctrl: true }), 'CmdOrCtrl+Shift+L')).toBe(false)
  })

  it('does not match a bare key against a modified accelerator', () => {
    expect(eventMatchesAccel(evt({ key: 'n' }), 'CmdOrCtrl+N')).toBe(false)
  })

  it('matches function keys with no modifier', () => {
    expect(eventMatchesAccel(evt({ key: 'F4' }), 'F4')).toBe(true)
    expect(eventMatchesAccel(evt({ key: 'F4', ctrl: true }), 'F4')).toBe(false)
  })
})

describe('matchBinding', () => {
  it('resolves an event to its command id', () => {
    const bindings = mergeBindings(null)
    expect(matchBinding(evt({ key: 'r', ctrl: true }), bindings)).toBe('view:refresh')
    expect(matchBinding(evt({ key: 'F10' }), bindings)).toBe('coll:open_tab')
    expect(matchBinding(evt({ key: 'z', ctrl: true }), bindings)).toBeNull()
  })

  it('matches Ctrl+Tab / Ctrl+Shift+Tab for next/prev tab', () => {
    const bindings = mergeBindings(null)
    expect(matchBinding(evt({ key: 'Tab', ctrl: true }), bindings)).toBe('view:next_tab')
    expect(matchBinding(evt({ key: 'Tab', ctrl: true, shift: true }), bindings)).toBe('view:prev_tab')
  })

  it('follows a rebind', () => {
    const bindings = mergeBindings({ 'view:refresh': 'CmdOrCtrl+Shift+R' })
    expect(matchBinding(evt({ key: 'r', ctrl: true }), bindings)).toBeNull()
    expect(matchBinding(evt({ key: 'r', ctrl: true, shift: true }), bindings)).toBe('view:refresh')
  })
})

describe('accelToTokens', () => {
  it('uses symbols on mac and words elsewhere', () => {
    expect(accelToTokens('CmdOrCtrl+Shift+L', true)).toEqual(['⌘', '⇧', 'L'])
    expect(accelToTokens('CmdOrCtrl+Shift+L', false)).toEqual(['Ctrl', 'Shift', 'L'])
  })
})

describe('accelFromEvent', () => {
  it('captures a modified letter', () => {
    expect(accelFromEvent(evt({ key: 'k', ctrl: true, shift: true }))).toBe('CmdOrCtrl+Shift+K')
  })

  it('captures a bare function key', () => {
    expect(accelFromEvent(evt({ key: 'F6' }))).toBe('F6')
  })

  it('rejects a lone modifier or a bare letter', () => {
    expect(accelFromEvent(evt({ key: 'Shift', shift: true }))).toBeNull()
    expect(accelFromEvent(evt({ key: 'a' }))).toBeNull()
  })

  it('captures Shift+Tab reported by WebKitGTK as "Unidentified" via code', () => {
    expect(accelFromEvent(evt({ key: 'Unidentified', code: 'Tab', ctrl: true, shift: true }))).toBe('CmdOrCtrl+Shift+Tab')
  })
})
