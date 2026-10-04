import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { grants, grantPrivileges, revokePrivileges } from './admin'

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

describe('grant and revoke', () => {
  const change = { role: 'app', objectKind: 'table', schema: 'public', object: 'orders', privileges: ['SELECT'] }

  it('sends a grant as one change', async () => {
    await grantPrivileges('c1', change)
    expect(invoke).toHaveBeenCalledWith('grant_pg_privileges', { id: 'c1', change })
  })

  it('sends a revoke as one change', async () => {
    await revokePrivileges('c1', change)
    expect(invoke).toHaveBeenCalledWith('revoke_pg_privileges', { id: 'c1', change })
  })
})
