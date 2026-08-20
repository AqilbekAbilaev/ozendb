import { describe, it, expect } from 'vitest'

// Regression for the startup-order bug (see tabs.js): a cold import of the store,
// with no workspace definitions registered, must not throw — main.js registers
// definitions in its body, which runs only after every static import, including the
// store, has evaluated. No registration, no initializeTabs, on purpose.
const { tabs, activeTabId } = await import('./tabs')

describe('cold store import', () => {
  it('evaluates without registration and leaves the tab list empty', () => {
    expect(tabs.value).toEqual([])
    expect(activeTabId.value).toBeNull()
  })
})