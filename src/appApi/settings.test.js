import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { getSettings, updateSettings, getKeybindings, updateKeybindings } from './settings'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getSettings', () => {
  it('invokes get_settings without arguments', async () => {
    invoke.mockResolvedValue({})
    await getSettings()
    expect(invoke).toHaveBeenCalledWith('get_settings')
  })
})

describe('updateSettings', () => {
  it('passes the settings patch through to update_settings', async () => {
    invoke.mockResolvedValue(null)
    await updateSettings({ theme: 'dark', uiZoom: 1.1 })
    expect(invoke).toHaveBeenCalledWith('update_settings', { theme: 'dark', uiZoom: 1.1 })
  })
})

describe('getKeybindings', () => {
  it('invokes get_keybindings without arguments', async () => {
    invoke.mockResolvedValue({})
    await getKeybindings()
    expect(invoke).toHaveBeenCalledWith('get_keybindings')
  })
})

describe('updateKeybindings', () => {
  it('passes the bindings through to update_keybindings', async () => {
    invoke.mockResolvedValue(null)
    await updateKeybindings({ 'run-query': ['Mod-Enter'] })
    expect(invoke).toHaveBeenCalledWith('update_keybindings', { bindings: { 'run-query': ['Mod-Enter'] } })
  })
})