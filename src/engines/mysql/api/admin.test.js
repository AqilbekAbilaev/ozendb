import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import * as admin from './admin'

beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockResolvedValue([])
})

const account = { user: "o'brien ü", host: '10.%' }

describe('MySQL server administration', () => {
  it('lists, creates and drops accounts, and reads one\'s grants', async () => {
    await admin.users('m1')
    await admin.createUser('m1', { ...account, password: 'pa ss' })
    await admin.dropUser('m1', account)
    await admin.grants('m1', account)
    expect(invoke.mock.calls).toEqual([
      ['list_mysql_users', { id: 'm1' }],
      ['create_mysql_user', { id: 'm1', user: { ...account, password: 'pa ss' } }],
      ['drop_mysql_user', { id: 'm1', user: "o'brien ü", host: '10.%' }],
      ['list_mysql_grants', { id: 'm1', user: "o'brien ü", host: '10.%' }],
    ])
  })

  it('sends a grant or revoke as one change', async () => {
    const change = { ...account, database: 'shop', table: null, privileges: ['SELECT'], grantOption: false }
    await admin.grantPrivileges('m1', change)
    await admin.revokePrivileges('m1', change)
    expect(invoke.mock.calls).toEqual([
      ['grant_mysql_privileges', { id: 'm1', change }],
      ['revoke_mysql_privileges', { id: 'm1', change }],
    ])
  })
})
