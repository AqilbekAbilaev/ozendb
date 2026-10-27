import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { useSavedQueryBrowser, watchSavedQueryBrowserTriggers } from './useSavedQueryBrowser'
import { requestSavedQueryBrowser } from '../../../stores/menuRequests'
import { tabs, activeTabId } from '../../../stores/tabs'
import { registerWorkspaceDefinitions } from '../../../workspaces/registerDefinitions'

// Whether a tab is a collection tab is a question for its definition.
registerWorkspaceDefinitions()

const orders = { id: 'orders ü.v2', type: 'mongodb.find' }
const people = { id: 'people/2024', type: 'mongodb.aggregate' }
const shell = { id: 'shell 1', type: 'mongodb.shell' }

// The always-mounted dialog's watchers, stopped after each test as an unmount would.
let scope = null
const browser = useSavedQueryBrowser()

beforeEach(() => {
  browser.close()
  browser.request.value = null
  tabs.value = [orders, people, shell]
  activeTabId.value = orders.id
  scope = effectScope()
  scope.run(watchSavedQueryBrowserTriggers)
})

afterEach(() => scope.stop())

describe('saved query browser', () => {
  it('opens on File → Load for the active collection tab', async () => {
    requestSavedQueryBrowser()
    await nextTick()
    expect(browser.isOpen.value).toBe(true)
    expect(browser.targetTabId.value).toBe(orders.id)
  })

  it('stays shut on File → Load when the active tab is not a collection tab', async () => {
    activeTabId.value = shell.id
    requestSavedQueryBrowser()
    await nextTick()
    expect(browser.isOpen.value).toBe(false)
  })

  it('applies the chosen query to the tab it was opened for after the active tab changed', async () => {
    requestSavedQueryBrowser()
    await nextTick()
    activeTabId.value = people.id

    browser.apply({ id: 'saved-1', mode: 'find' })

    expect(activeTabId.value).toBe(orders.id)
    expect(browser.request.value).toMatchObject({ tabId: orders.id, entry: { id: 'saved-1', mode: 'find' } })
    expect(browser.isOpen.value).toBe(false)
  })

  it('clears an applied request once its pane acknowledges it', () => {
    browser.open(orders)
    browser.apply({ id: 'saved-1' })
    browser.acknowledge(browser.request.value.nonce)
    expect(browser.request.value).toBe(null)
  })

  it('dismisses the browser when the tab it was opened for closes', async () => {
    browser.open(orders)
    tabs.value = [people, shell]
    await nextTick()
    expect(browser.isOpen.value).toBe(false)
    expect(browser.targetTabId.value).toBe(null)
  })

  it('drops a pending request when its tab closes', async () => {
    browser.open(orders)
    browser.apply({ id: 'saved-1' })
    tabs.value = [people, shell]
    await nextTick()
    expect(browser.request.value).toBe(null)
  })
})
