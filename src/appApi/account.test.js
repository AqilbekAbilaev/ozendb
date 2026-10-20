import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { getEntitlement } from './account'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getEntitlement', () => {
  it('invokes get_entitlement without arguments', async () => {
    invoke.mockResolvedValue({ state: 'free' })
    await getEntitlement()
    expect(invoke).toHaveBeenCalledWith('get_entitlement')
  })
})
