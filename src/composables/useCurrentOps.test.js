import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useCurrentOps, OPS_DEFAULTS } from './useCurrentOps'

// Switching workspace tabs unmounts the pane, so anything held in a plain ref inside it
// is gone when the user comes back. The toolbar settings live on the tab object for that
// reason, and one component instance is reused across tabs of the same kind — so the
// settings must follow whichever tab is active, not the one that was active at setup.

const newTab = (over = {}) => ({ id: 't1', connId: 'c1', connName: 'Local', ...OPS_DEFAULTS, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue({ inprog: [] })
})

describe('toolbar settings', () => {
  it('writes through to the tab, so they survive a tab switch', () => {
    const tab = newTab()
    const { retention, showSys } = useCurrentOps(() => tab)

    retention.value = 0
    showSys.value = true

    expect(tab.retention).toBe(0)
    expect(tab.showSys).toBe(true)
  })

  // `active` stands in for the pane's activeTab prop, which changes under one reused
  // component instance when the user switches between two of these tabs.
  it('reads the tab that is active now, not the one it was created with', () => {
    const active = ref(newTab({ id: 't1', retention: 0 }))
    const { retention } = useCurrentOps(() => active.value)
    expect(retention.value).toBe(0)

    active.value = newTab({ id: 't2', retention: 30_000 })
    expect(retention.value).toBe(30_000)
  })

  it('asks the server for the ops the filters imply', async () => {
    const tab = newTab({ ownOnly: true, showSys: true })
    const { load } = useCurrentOps(() => tab)

    await load()

    expect(invoke).toHaveBeenCalledWith('current_ops', { id: 'c1', ownOnly: true, all: true })
  })
})
