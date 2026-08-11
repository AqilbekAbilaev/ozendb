import { describe, it, expect } from 'vitest'
import { HELP_URLS, isHelpLink } from './helpLinks'

// The menu ids in this table are the contract with src-tauri/src/menu/table.rs — an id
// that drifts out of step goes silently dead, because handleMenuAction falls through to
// the switch and finds no arm.
describe('isHelpLink', () => {
  it('claims every id in the table', () => {
    for (const id of Object.keys(HELP_URLS)) expect(isHelpLink(id)).toBe(true)
  })

  it('does not claim other menu ids', () => {
    expect(isHelpLink('help:about')).toBe(false)
    expect(isHelpLink('file:connect')).toBe(false)
  })

  // Check for Updates… runs a real update check. If it ever reappears in the table the
  // link handler claims it before the switch, and the menu item silently goes back to
  // opening a web page.
  it('does not claim help:updates', () => {
    expect(isHelpLink('help:updates')).toBe(false)
  })

  // Guards against a key like `constructor` or `toString` resolving off the prototype
  // and sending openUrl a function instead of a URL.
  it('does not claim inherited object properties', () => {
    expect(isHelpLink('constructor')).toBe(false)
    expect(isHelpLink('toString')).toBe(false)
  })
})

describe('HELP_URLS', () => {
  it('points every entry at a real https URL', () => {
    for (const url of Object.values(HELP_URLS)) {
      expect(url).toMatch(/^https:\/\//)
    }
  })
})
