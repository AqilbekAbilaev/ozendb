import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  listIndexes,
  createIndex,
  dropIndex,
  setIndexHidden,
  indexStats,
} from './indexes'

const target = { connectionId: 'connection-1', database: 'app', collection: 'users' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listIndexes', () => {
  it('translates the target into the list_indexes payload', async () => {
    invoke.mockResolvedValue([])
    await listIndexes(target)
    expect(invoke).toHaveBeenCalledWith('list_indexes', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
    })
  })
})

describe('indexStats', () => {
  it('translates the target into the index_stats payload', async () => {
    invoke.mockResolvedValue([])
    await indexStats(target)
    expect(invoke).toHaveBeenCalledWith('index_stats', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
    })
  })
})

describe('createIndex', () => {
  it('translates the target, keys and options into the create_index payload', async () => {
    invoke.mockResolvedValue(null)
    await createIndex(target, '{ "email": 1 }', '{ "unique": true }')
    expect(invoke).toHaveBeenCalledWith('create_index', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      keys:       '{ "email": 1 }',
      options:    '{ "unique": true }',
    })
  })

  it('defaults options to an empty document when omitted', async () => {
    invoke.mockResolvedValue(null)
    await createIndex(target, '{ "email": 1 }')
    expect(invoke).toHaveBeenCalledWith('create_index', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      keys:       '{ "email": 1 }',
      options:    '{}',
    })
  })
})

describe('dropIndex', () => {
  it('translates the target and name into the drop_index payload', async () => {
    invoke.mockResolvedValue(null)
    await dropIndex(target, 'email_1')
    expect(invoke).toHaveBeenCalledWith('drop_index', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      name:       'email_1',
    })
  })
})

describe('setIndexHidden', () => {
  it('translates the target, name and hidden flag into the set_index_hidden payload', async () => {
    invoke.mockResolvedValue(null)
    await setIndexHidden(target, 'email_1', true)
    expect(invoke).toHaveBeenCalledWith('set_index_hidden', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      name:       'email_1',
      hidden:     true,
    })
  })
})