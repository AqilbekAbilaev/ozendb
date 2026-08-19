import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { setMenuContext } from './menu'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('setMenuContext', () => {
  it('passes the complete context through to set_menu_context', async () => {
    invoke.mockResolvedValue(null)
    const context = {
      hasConnection: true,
      hasDatabase:   false,
      hasCollection: true,
      anyConnection: true,
      hasDocument:   false,
      hasField:      true,
      hasIndex:      false,
      readOnly:      true,
    }
    await setMenuContext(context)
    expect(invoke).toHaveBeenCalledWith('set_menu_context', context)
  })
})