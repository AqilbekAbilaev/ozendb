import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { grants } from './admin'

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue([])
})

describe('grants', () => {
  it('reads a role\'s direct grants', async () => {
    await grants('c1', 'app_readonly')
    expect(invoke).toHaveBeenCalledWith('list_pg_grants', { id: 'c1', role: 'app_readonly' })
  })
})
