import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  testConnection,
  testSshConnection,
  listConnections,
  saveConnection,
  updateConnection,
  deleteConnection,
  disconnect,
  connectionUri,
  duplicateConnection,
  exportConnections,
  importConnections,
} from './connections'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('testConnection', () => {
  it('translates the id and fields into the test_connection payload', async () => {
    invoke.mockResolvedValue(null)
    const fields = { name: 'local', hosts: [{ host: 'localhost', port: 27017 }] }
    await testConnection('connection-1', fields)
    expect(invoke).toHaveBeenCalledWith('test_connection', { id: 'connection-1', fields })
  })

  it('passes a null id for an unsaved connection', async () => {
    invoke.mockResolvedValue(null)
    await testConnection(null, { name: 'new' })
    expect(invoke).toHaveBeenCalledWith('test_connection', { id: null, fields: { name: 'new' } })
  })

  it('rejects with the command error unchanged', async () => {
    const error = { code: 'network', message: 'no route' }
    invoke.mockRejectedValue(error)
    await expect(testConnection('connection-1', {})).rejects.toBe(error)
  })
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

describe('listConnections', () => {
  it('calls list_connections with no arguments', async () => {
    invoke.mockResolvedValue([])
    await listConnections()
    expect(invoke).toHaveBeenCalledWith('list_connections')
  })

  it('resolves with the command response unchanged', async () => {
    const response = [{ id: 'c1', name: 'local' }]
    invoke.mockResolvedValue(response)
    await expect(listConnections()).resolves.toBe(response)
  })
})

describe('saveConnection', () => {
  it('translates the fields into the save_connection payload', async () => {
    invoke.mockResolvedValue('new-id')
    const fields = { name: 'local' }
    await saveConnection(fields, null)
    expect(invoke).toHaveBeenCalledWith('save_connection', { fields, copySecretsFrom: null })
  })

  it('passes a copy-secrets source id through', async () => {
    invoke.mockResolvedValue('new-id')
    await saveConnection({ name: 'local' }, 'source-id')
    expect(invoke).toHaveBeenCalledWith('save_connection', { fields: { name: 'local' }, copySecretsFrom: 'source-id' })
  })
})

describe('updateConnection', () => {
  it('translates the id and fields into the update_connection payload', async () => {
    invoke.mockResolvedValue({ id: 'connection-1' })
    const fields = { name: 'renamed' }
    await updateConnection('connection-1', fields)
    expect(invoke).toHaveBeenCalledWith('update_connection', { id: 'connection-1', fields })
  })
})

describe('deleteConnection', () => {
  it('translates the id into the delete_connection payload', async () => {
    invoke.mockResolvedValue(null)
    await deleteConnection('connection-1')
    expect(invoke).toHaveBeenCalledWith('delete_connection', { id: 'connection-1' })
  })
})

describe('disconnect', () => {
  it('translates the id into the disconnect payload', async () => {
    invoke.mockResolvedValue(null)
    await disconnect('connection-1')
    expect(invoke).toHaveBeenCalledWith('disconnect', { id: 'connection-1' })
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

describe('duplicateConnection', () => {
  it('translates the id into the duplicate_connection payload', async () => {
    invoke.mockResolvedValue({ id: 'dup-1' })
    await duplicateConnection('connection-1')
    expect(invoke).toHaveBeenCalledWith('duplicate_connection', { id: 'connection-1' })
  })
})

describe('exportConnections', () => {
  it('translates the path into the export_connections payload', async () => {
    invoke.mockResolvedValue(2)
    await exportConnections('/tmp/conns.json')
    expect(invoke).toHaveBeenCalledWith('export_connections', { path: '/tmp/conns.json' })
  })
})

describe('importConnections', () => {
  it('translates the path into the import_connections payload', async () => {
    invoke.mockResolvedValue(2)
    await importConnections('/tmp/conns.json')
    expect(invoke).toHaveBeenCalledWith('import_connections', { path: '/tmp/conns.json' })
  })
})