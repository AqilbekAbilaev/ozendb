import { describe, expect, it, vi } from 'vitest'
import { useSavedQueryBrowser } from './useSavedQueryBrowser'

describe('saved query browser lifetime', () => {
  it('keeps the opening collection as the load target after a workspace switch', () => {
    const activate = vi.fn()
    const browser = useSavedQueryBrowser({ activate })
    const openingTab = { id: 'orders', kind: 'collection' }

    browser.open(openingTab)
    browser.apply({ id: 'saved-1', mode: 'find' })

    expect(activate).toHaveBeenCalledWith('orders')
    expect(browser.request.value).toMatchObject({
      tabId: 'orders',
      entry: { id: 'saved-1', mode: 'find' },
    })
    expect(browser.isOpen.value).toBe(false)
  })

  it('clears an applied request and dismisses when the target closes', () => {
    const browser = useSavedQueryBrowser({ activate: vi.fn() })
    browser.open({ id: 'orders', kind: 'collection' })
    browser.apply({ id: 'saved-1' })
    const nonce = browser.request.value.nonce

    browser.acknowledge(nonce)
    expect(browser.request.value).toBe(null)

    browser.open({ id: 'orders', kind: 'collection' })
    browser.retainTargets(new Set(['people']))
    expect(browser.isOpen.value).toBe(false)
    expect(browser.targetTabId.value).toBe(null)
  })
})
