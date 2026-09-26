import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  testSshConnection,
  connectionUri,
} from './connections'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('testSshConnection', () => {
  it('passes the ssh fields through to the test_ssh_connection payload', async () => {
    invoke.mockResolvedValue(null)
    const fields = {
      sshHost:       'tunnel.example',
      sshPort:       22,
      sshUser:       'me',
      sshAuth:       'password',
      sshPassword:   'secret',
      sshKeyFile:    null,
      sshPassphrase: null,
      mongoHost:     'localhost',
      mongoPort:     27017,
      username:      'admin',
      password:      null,
      authDb:        'admin',
      authMechanism: 'SCRAM-SHA-256',
    }
    await testSshConnection(fields)
    expect(invoke).toHaveBeenCalledWith('test_ssh_connection', fields)
  })
})

describe('connectionUri', () => {
  it('translates the id into the connection_uri payload', async () => {
    invoke.mockResolvedValue('mongodb://localhost:27017')
    await connectionUri('connection-1')
    expect(invoke).toHaveBeenCalledWith('connection_uri', { id: 'connection-1' })
  })

  it('resolves with the command response unchanged', async () => {
    const uri = 'mongodb://localhost:27017'
    invoke.mockResolvedValue(uri)
    await expect(connectionUri('connection-1')).resolves.toBe(uri)
  })
})
