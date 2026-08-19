import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  collectionStats,
  databaseStats,
  serverStatus,
  serverInfo,
  currentOps,
  killOp,
  getProfilingStatus,
  setProfilingLevel,
  listProfile,
  getValidator,
  setValidator,
  listUsers,
  createUser,
  dropUser,
  copyUsersToConnection,
  listRoles,
  listFunctions,
  saveFunction,
  dropFunction,
} from './admin'

const dbTarget  = { connectionId: 'connection-1', database: 'app' }
const collTarget = { connectionId: 'connection-1', database: 'app', collection: 'users' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('collectionStats', () => {
  it('translates the target into the collection_stats payload', async () => {
    invoke.mockResolvedValue({})
    await collectionStats(collTarget)
    expect(invoke).toHaveBeenCalledWith('collection_stats', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
    })
  })
})

describe('databaseStats', () => {
  it('translates the target into the database_stats payload', async () => {
    invoke.mockResolvedValue({})
    await databaseStats(dbTarget)
    expect(invoke).toHaveBeenCalledWith('database_stats', {
      id:         'connection-1',
      database:   'app',
    })
  })
})

describe('serverStatus', () => {
  it('translates the connection id into the server_status payload', async () => {
    invoke.mockResolvedValue({})
    await serverStatus('connection-1')
    expect(invoke).toHaveBeenCalledWith('server_status', { id: 'connection-1' })
  })
})

describe('serverInfo', () => {
  it('translates the connection id and kind into the server_info payload', async () => {
    invoke.mockResolvedValue({})
    await serverInfo('connection-1', 'buildinfo')
    expect(invoke).toHaveBeenCalledWith('server_info', { id: 'connection-1', kind: 'buildinfo' })
  })
})

describe('currentOps', () => {
  it('translates the connection id and options into the current_ops payload', async () => {
    invoke.mockResolvedValue({ inprog: [] })
    await currentOps('connection-1', { ownOnly: true, all: false })
    expect(invoke).toHaveBeenCalledWith('current_ops', { id: 'connection-1', ownOnly: true, all: false })
  })

  it('omits options that are not provided', async () => {
    invoke.mockResolvedValue({ inprog: [] })
    await currentOps('connection-1')
    expect(invoke).toHaveBeenCalledWith('current_ops', { id: 'connection-1' })
  })
})

describe('killOp', () => {
  it('translates the connection id and opid into the kill_op payload', async () => {
    invoke.mockResolvedValue(null)
    await killOp('connection-1', 42)
    expect(invoke).toHaveBeenCalledWith('kill_op', { id: 'connection-1', opid: 42 })
  })
})

describe('getProfilingStatus', () => {
  it('translates the target into the get_profiling_status payload', async () => {
    invoke.mockResolvedValue({ was: 0 })
    await getProfilingStatus(dbTarget)
    expect(invoke).toHaveBeenCalledWith('get_profiling_status', {
      id:         'connection-1',
      database:   'app',
    })
  })
})

describe('setProfilingLevel', () => {
  it('translates the target, level and slowms into the set_profiling_level payload', async () => {
    invoke.mockResolvedValue({})
    await setProfilingLevel(dbTarget, 1, 100)
    expect(invoke).toHaveBeenCalledWith('set_profiling_level', {
      id:         'connection-1',
      database:   'app',
      level:      1,
      slowms:     100,
    })
  })
})

describe('listProfile', () => {
  it('translates the target, limit and slower-than filter into the list_profile payload', async () => {
    invoke.mockResolvedValue([])
    await listProfile(dbTarget, 50, 200)
    expect(invoke).toHaveBeenCalledWith('list_profile', {
      id:           'connection-1',
      database:     'app',
      limit:        50,
      slowerThanMs: 200,
    })
  })

  it('omits the slower-than filter when null', async () => {
    invoke.mockResolvedValue([])
    await listProfile(dbTarget, 50, null)
    expect(invoke).toHaveBeenCalledWith('list_profile', {
      id:           'connection-1',
      database:     'app',
      limit:        50,
      slowerThanMs: null,
    })
  })
})

describe('getValidator', () => {
  it('translates the target into the get_validator payload', async () => {
    invoke.mockResolvedValue({ validator: '' })
    await getValidator(collTarget)
    expect(invoke).toHaveBeenCalledWith('get_validator', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
    })
  })
})

describe('setValidator', () => {
  it('translates the target, validator and options into the set_validator payload', async () => {
    invoke.mockResolvedValue(null)
    await setValidator(collTarget, '{ "a": 1 }', 'moderate', 'error')
    expect(invoke).toHaveBeenCalledWith('set_validator', {
      id:               'connection-1',
      database:         'app',
      collection:       'users',
      validator:        '{ "a": 1 }',
      validationLevel:  'moderate',
      validationAction: 'error',
    })
  })
})

describe('listUsers', () => {
  it('translates the target into the list_users payload', async () => {
    invoke.mockResolvedValue([])
    await listUsers(dbTarget)
    expect(invoke).toHaveBeenCalledWith('list_users', { id: 'connection-1', database: 'app' })
  })
})

describe('createUser', () => {
  it('translates the target and credentials into the create_user payload', async () => {
    invoke.mockResolvedValue(null)
    await createUser(dbTarget, 'alice', 'secret', ['read', 'readWrite'])
    expect(invoke).toHaveBeenCalledWith('create_user', {
      id:       'connection-1',
      database: 'app',
      username: 'alice',
      password: 'secret',
      roles:    ['read', 'readWrite'],
    })
  })
})

describe('dropUser', () => {
  it('translates the target and username into the drop_user payload', async () => {
    invoke.mockResolvedValue(null)
    await dropUser(dbTarget, 'alice')
    expect(invoke).toHaveBeenCalledWith('drop_user', {
      id:       'connection-1',
      database: 'app',
      username: 'alice',
    })
  })
})

describe('copyUsersToConnection', () => {
  it('translates the source target and destination into the copy_users_to_connection payload', async () => {
    invoke.mockResolvedValue([{ status: 'ok' }])
    await copyUsersToConnection(dbTarget, 'connection-2', 'other')
    expect(invoke).toHaveBeenCalledWith('copy_users_to_connection', {
      sourceId:       'connection-1',
      sourceDatabase: 'app',
      targetId:       'connection-2',
      targetDatabase: 'other',
    })
  })
})

describe('listRoles', () => {
  it('translates the target into the list_roles payload', async () => {
    invoke.mockResolvedValue([])
    await listRoles(dbTarget)
    expect(invoke).toHaveBeenCalledWith('list_roles', { id: 'connection-1', database: 'app' })
  })
})

describe('listFunctions', () => {
  it('translates the target into the list_functions payload', async () => {
    invoke.mockResolvedValue([])
    await listFunctions(dbTarget)
    expect(invoke).toHaveBeenCalledWith('list_functions', { id: 'connection-1', database: 'app' })
  })
})

describe('saveFunction', () => {
  it('translates the target, name and body into the save_function payload', async () => {
    invoke.mockResolvedValue(null)
    await saveFunction(dbTarget, 'double', 'function (x) { return x * 2 }')
    expect(invoke).toHaveBeenCalledWith('save_function', {
      id:       'connection-1',
      database: 'app',
      name:     'double',
      body:     'function (x) { return x * 2 }',
    })
  })
})

describe('dropFunction', () => {
  it('translates the target and name into the drop_function payload', async () => {
    invoke.mockResolvedValue(null)
    await dropFunction(dbTarget, 'double')
    expect(invoke).toHaveBeenCalledWith('drop_function', {
      id:       'connection-1',
      database: 'app',
      name:     'double',
    })
  })
})