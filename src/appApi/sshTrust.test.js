import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import { respondSshHostKey, forgetSshHost } from './sshTrust'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('respondSshHostKey', () => {
  it('passes the request id and trust flag through to respond_ssh_host_key', async () => {
    invoke.mockResolvedValue(null)
    await respondSshHostKey(41, true)
    expect(invoke).toHaveBeenCalledWith('respond_ssh_host_key', { requestId: 41, trust: true })
  })
})

describe('forgetSshHost', () => {
  it('passes the host and port through to forget_ssh_host', async () => {
    invoke.mockResolvedValue(null)
    await forgetSshHost('db.example.com', 22)
    expect(invoke).toHaveBeenCalledWith('forget_ssh_host', { host: 'db.example.com', port: 22 })
  })
})