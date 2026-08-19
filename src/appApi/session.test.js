import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { getOpenTabs, setOpenTabs } from './session'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getOpenTabs', () => {
  it('invokes get_open_tabs without arguments', async () => {
    invoke.mockResolvedValue({ tabs: [] })
    await getOpenTabs()
    expect(invoke).toHaveBeenCalledWith('get_open_tabs')
  })
})

describe('setOpenTabs', () => {
  it('passes the session through to set_open_tabs', async () => {
    invoke.mockResolvedValue(null)
    await setOpenTabs({ tabs: [] })
    expect(invoke).toHaveBeenCalledWith('set_open_tabs', { session: { tabs: [] } })
  })
})