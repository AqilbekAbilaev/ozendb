import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setZoom = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ setZoom }),
}))

vi.mock('../appApi/settings', () => ({
  getKeybindings: vi.fn(),
  getSettings: vi.fn(),
  updateKeybindings: vi.fn(),
  updateSettings: vi.fn(),
}))

import { getKeybindings, getSettings, updateKeybindings, updateSettings } from '../appApi/settings'
import {
  defaultQueryLimit,
  defaultResultView,
  editorTabWidth,
  keyBindings,
  loadSettings,
  resetSettings,
  zoom,
  restoreSessionEnabled,
  saveKeybindings,
  savePreferences,
  setTheme,
  theme,
} from './settings'

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('document', { documentElement: { dataset: {} } })
  vi.stubGlobal('localStorage', { setItem: vi.fn() })
  resetSettings()
})

afterEach(() => vi.unstubAllGlobals())

const settings = {
  default_query_limit: 100,
  theme: 'light',
  default_result_view: 'json',
  restore_session: false,
  editor_tab_width: 8,
}

describe('settings store', () => {
  it('loads normalized backend settings and merged keybindings', async () => {
    getSettings.mockResolvedValue(settings)
    getKeybindings.mockResolvedValue({ 'file:connect': 'F2', unknown: 'F3' })

    await loadSettings()

    expect(defaultQueryLimit.value).toBe(100)
    expect(theme.value).toBe('light')
    expect(defaultResultView.value).toBe('json')
    expect(restoreSessionEnabled.value).toBe(false)
    expect(editorTabWidth.value).toBe(8)
    expect(keyBindings.value['file:connect']).toBe('F2')
    expect(keyBindings.value.unknown).toBeUndefined()
  })

  it('applies theme to the document and local mirror after a successful save', async () => {
    updateSettings.mockResolvedValue(settings)
    await setTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.setItem).toHaveBeenCalledWith('s4t-theme', 'light')
  })

  it('does not change live settings when saving preferences fails', async () => {
    updateSettings.mockRejectedValue(new Error('offline'))
    await expect(savePreferences({ theme: 'light' })).rejects.toThrow('offline')
    expect(theme.value).toBe('dark')
    expect(defaultQueryLimit.value).toBe(50)
  })

  it('merges saved keybindings into the defaults', async () => {
    updateKeybindings.mockResolvedValue({ 'file:connect': 'F2' })
    await saveKeybindings({ 'file:connect': 'F2' })
    expect(keyBindings.value['file:connect']).toBe('F2')
    expect(keyBindings.value['file:sql']).toBeTruthy()
  })

  it('resets module state explicitly between tests', () => {
    theme.value = 'light'
    resetSettings()
    expect(theme.value).toBe('dark')
  })
})

describe('zoom', () => {
  it('applies the saved zoom to the webview on load', async () => {
    getSettings.mockResolvedValue({ ui_zoom: 1.25 })
    getKeybindings.mockResolvedValue({})
    await loadSettings()
    expect(zoom.value).toBe(1.25)
    expect(setZoom).toHaveBeenCalledWith(1.25)
  })

  it('snaps a hand-edited value onto the ladder', async () => {
    getSettings.mockResolvedValue({ ui_zoom: 3.7 })
    getKeybindings.mockResolvedValue({})
    await loadSettings()
    expect(zoom.value).toBe(2)
    expect(setZoom).toHaveBeenCalledWith(2)
  })

  it('falls back to 100% when nothing is stored', async () => {
    getSettings.mockResolvedValue({})
    getKeybindings.mockResolvedValue({})
    await loadSettings()
    expect(zoom.value).toBe(1)
  })

  // A webview that refuses the zoom must not take the rest of startup down with it.
  it('still resolves when the webview rejects the zoom', async () => {
    getSettings.mockResolvedValue({ ui_zoom: 1.5 })
    getKeybindings.mockResolvedValue({})
    setZoom.mockRejectedValueOnce(new Error('no zoom here'))
    await expect(loadSettings()).resolves.toBeTruthy()
    expect(zoom.value).toBe(1.5)
  })
})
