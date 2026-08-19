import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  listDatabases,
  createCollection,
  createDatabase,
  createView,
  dropDatabase,
  dropCollection,
  renameCollection,
} from './resources'

const target = { connectionId: 'connection-1', database: 'app', collection: 'users' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listDatabases', () => {
  it('translates the connection id into the list_databases payload', async () => {
    invoke.mockResolvedValue([])
    await listDatabases('connection-1')
    expect(invoke).toHaveBeenCalledWith('list_databases', { id: 'connection-1' })
  })

  it('resolves with the command response unchanged', async () => {
    const response = [{ name: 'app' }]
    invoke.mockResolvedValue(response)
    await expect(listDatabases('connection-1')).resolves.toBe(response)
  })
})

describe('createCollection', () => {
  it('translates the target, name and options into the create_collection payload', async () => {
    invoke.mockResolvedValue(null)
    await createCollection(target, 'logs', { capped: true })
    expect(invoke).toHaveBeenCalledWith('create_collection', {
      id:         'connection-1',
      database:   'app',
      name:       'logs',
      options:    { capped: true },
    })
  })

  it('omits options when none are provided', async () => {
    invoke.mockResolvedValue(null)
    await createCollection(target, 'logs')
    expect(invoke).toHaveBeenCalledWith('create_collection', {
      id:         'connection-1',
      database:   'app',
      name:       'logs',
    })
  })
})

describe('createDatabase', () => {
  it('translates the target and first collection into the create_database payload', async () => {
    invoke.mockResolvedValue(null)
    await createDatabase({ connectionId: 'connection-1', database: 'app' }, 'first')
    expect(invoke).toHaveBeenCalledWith('create_database', {
      id:             'connection-1',
      database:       'app',
      firstCollection: 'first',
    })
  })
})

describe('createView', () => {
  it('translates the target, view spec and pipeline into the create_view payload', async () => {
    invoke.mockResolvedValue(null)
    await createView(target, 'recent', 'users', '[{ "$match": {} }]')
    expect(invoke).toHaveBeenCalledWith('create_view', {
      id:         'connection-1',
      database:   'app',
      name:       'recent',
      viewOn:     'users',
      pipeline:   '[{ "$match": {} }]',
    })
  })
})

describe('dropDatabase', () => {
  it('translates the target into the drop_database payload', async () => {
    invoke.mockResolvedValue(null)
    await dropDatabase({ connectionId: 'connection-1', database: 'app' })
    expect(invoke).toHaveBeenCalledWith('drop_database', { id: 'connection-1', database: 'app' })
  })
})

describe('dropCollection', () => {
  it('translates the target into the drop_collection payload', async () => {
    invoke.mockResolvedValue(null)
    await dropCollection(target)
    expect(invoke).toHaveBeenCalledWith('drop_collection', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
    })
  })
})

describe('renameCollection', () => {
  it('translates the target and new name into the rename_collection payload', async () => {
    invoke.mockResolvedValue(null)
    await renameCollection(target, 'users_v2')
    expect(invoke).toHaveBeenCalledWith('rename_collection', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      newName:    'users_v2',
    })
  })
})