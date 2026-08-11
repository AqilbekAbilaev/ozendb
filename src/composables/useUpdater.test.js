import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { useUpdater } from './useUpdater'

// The updater has two audiences that must not be confused: installs that can replace
// themselves (macOS, Windows, Linux AppImage) and installs that can't (deb/rpm, owned
// by the package manager). Offering an in-place install to the second kind fails only
// after the user has agreed to it, so the split is what these pin.

function harness() {
  const calls = { toasts: [], opened: [], closed: [], downloads: 0 }
  const api = useUpdater({
    showToast: (m) => calls.toasts.push(m),
    openModal: (id) => calls.opened.push(id),
    closeModal: (id) => calls.closed.push(id),
    openDownloadsPage: () => { calls.downloads += 1 },
  })
  return { api, calls }
}

const anUpdate = (over = {}) => ({
  version: '0.1.5',
  body: 'notes',
  downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue(true)
})

describe('checking', () => {
  it('says nothing on a silent check when already up to date', async () => {
    check.mockResolvedValue(null)
    const { api, calls } = harness()
    await api.checkOnLaunch()
    expect(calls.toasts).toEqual([])
    expect(calls.opened).toEqual([])
  })

  it('confirms up-to-date on a manual check, so the menu item never looks dead', async () => {
    check.mockResolvedValue(null)
    const { api, calls } = harness()
    await api.checkNow()
    expect(calls.toasts).toHaveLength(1)
    expect(calls.opened).toEqual([])
  })

  it('stays quiet when a silent check fails', async () => {
    check.mockRejectedValue(new Error('offline'))
    const { api, calls } = harness()
    await api.checkOnLaunch()
    expect(calls.toasts).toEqual([])
  })

  it('reports a failed manual check', async () => {
    check.mockRejectedValue(new Error('offline'))
    const { api, calls } = harness()
    await api.checkNow()
    expect(calls.toasts).toHaveLength(1)
  })

  it('ignores a second check while one is in flight', async () => {
    let release
    check.mockReturnValue(new Promise((r) => { release = () => r(null) }))
    const { api } = harness()
    const first = api.checkNow()
    await api.checkNow()
    expect(check).toHaveBeenCalledTimes(1)
    release()
    await first
  })
})

describe('what an available update offers', () => {
  it('offers an in-place install where the bundle can replace itself', async () => {
    check.mockResolvedValue(anUpdate())
    invoke.mockResolvedValue(true)
    const { api, calls } = harness()
    await api.checkNow()
    expect(calls.opened).toEqual(['update'])
    expect(api.canInstall.value).toBe(true)
    expect(api.pending.value.version).toBe('0.1.5')
  })

  it('offers the downloads page on a deb/rpm install', async () => {
    check.mockResolvedValue(anUpdate())
    invoke.mockResolvedValue(false)
    const { api, calls } = harness()
    await api.checkNow()
    expect(calls.opened).toEqual(['update'])
    expect(api.canInstall.value).toBe(false)
  })

  // Failing safe matters more than being right: promising an install that then fails is
  // worse than sending a Mac user to a download page that works.
  it('falls back to the downloads page when the platform probe fails', async () => {
    check.mockResolvedValue(anUpdate())
    invoke.mockRejectedValue(new Error('no such command'))
    const { api } = harness()
    await api.checkNow()
    expect(api.canInstall.value).toBe(false)
  })
})

describe('installing', () => {
  it('installs, then relaunches', async () => {
    const update = anUpdate()
    check.mockResolvedValue(update)
    const { api } = harness()
    await api.checkNow()
    await api.install()
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(relaunch).toHaveBeenCalledTimes(1)
  })

  it('tracks download progress for the bar', async () => {
    const update = anUpdate({
      downloadAndInstall: vi.fn(async (onEvent) => {
        onEvent({ event: 'Started', data: { contentLength: 100 } })
        onEvent({ event: 'Progress', data: { chunkLength: 30 } })
        onEvent({ event: 'Progress', data: { chunkLength: 20 } })
      }),
    })
    check.mockResolvedValue(update)
    const { api } = harness()
    await api.checkNow()
    await api.install()
    expect(api.total.value).toBe(100)
    expect(api.downloaded.value).toBe(50)
  })

  it('reports a failed install and does not relaunch', async () => {
    const update = anUpdate({ downloadAndInstall: vi.fn().mockRejectedValue(new Error('boom')) })
    check.mockResolvedValue(update)
    const { api, calls } = harness()
    await api.checkNow()
    await api.install()
    expect(relaunch).not.toHaveBeenCalled()
    expect(calls.toasts).toHaveLength(1)
    expect(api.installing.value).toBe(false)
  })
})

// App.vue binds the dialog through this alone, so a renamed field here silently blanks
// the modal rather than failing loudly.
describe('dialogProps', () => {
  it('carries everything the dialog renders', async () => {
    check.mockResolvedValue(anUpdate())
    invoke.mockResolvedValue(true)
    const { api } = harness()
    await api.checkNow()
    expect(api.dialogProps.value).toEqual({
      update: api.pending.value,
      canInstall: true,
      installing: false,
      downloaded: 0,
      total: 0,
    })
  })
})

describe('the downloads fallback', () => {
  it('closes the dialog and opens the releases page', async () => {
    check.mockResolvedValue(anUpdate())
    invoke.mockResolvedValue(false)
    const { api, calls } = harness()
    await api.checkNow()
    api.openDownloads()
    expect(calls.downloads).toBe(1)
    expect(calls.closed).toEqual(['update'])
  })
})
