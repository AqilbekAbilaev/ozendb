import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { canSelfUpdate } from './updater'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('canSelfUpdate', () => {
  it('invokes can_self_update without arguments', async () => {
    invoke.mockResolvedValue(true)
    await canSelfUpdate()
    expect(invoke).toHaveBeenCalledWith('can_self_update')
  })
})