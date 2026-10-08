import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(), emit: vi.fn() }))

import { listen, emit } from '@tauri-apps/api/event'
import * as events from './events'

beforeEach(() => {
  vi.clearAllMocks()
  listen.mockResolvedValue(() => {})
})

// Each subscriber listens on its own event and hands the handler the payload alone.
const SUBSCRIBERS = [
  ['onMenuAction', 'menu-action'],
  ['onOperationsChanged', 'operations-changed'],
  ['onDocumentTarget', 'document-target'],
  ['onSshHostKeyPrompt', 'ssh-host-key-prompt'],
  ['onSshHostKeyChanged', 'ssh-host-key-changed'],
  ['onDocumentSaved', 'document-saved'],
  ['onConnectionSaved', 'connection-saved'],
  ['onConnectionUpdated', 'connection-updated'],
  ['onConnectionDeleted', 'connection-deleted'],
]

describe('subscribers', () => {
  it.each(SUBSCRIBERS)('%s listens on %s and passes the payload', async (fn, name) => {
    const handler = vi.fn()
    const unlisten = await events[fn](handler)
    expect(listen).toHaveBeenCalledWith(name, expect.any(Function))
    expect(typeof unlisten).toBe('function')
    listen.mock.calls[0][1]({ event: name, payload: { id: 'c1' } })
    expect(handler).toHaveBeenCalledWith({ id: 'c1' })
  })
})

describe('emitters', () => {
  it.each([
    ['emitDocumentSaved', 'document-saved'],
    ['emitConnectionSaved', 'connection-saved'],
    ['emitConnectionUpdated', 'connection-updated'],
    ['emitConnectionDeleted', 'connection-deleted'],
  ])('%s emits %s with the payload', async (fn, name) => {
    await events[fn]({ id: 'c1' })
    expect(emit).toHaveBeenCalledWith(name, { id: 'c1' })
  })
})
