import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  getDefaultQuery,
  setDefaultQuery,
  clearDefaultQuery,
  listSavedQueries,
  saveQuery,
  deleteSavedQuery,
  getQueryHistory,
  pushQueryHistory,
  clearQueryHistory,
} from './queryLibrary'

const target = { connectionId: 'connection-1', database: 'app', collection: 'users' }

beforeEach(() => {
  vi.clearAllMocks()
})

// Default-query and history commands key on connection_id (not the id key the
// connection-level commands use), so these payloads spell the target differently.

describe('getDefaultQuery', () => {
  it('translates the target into the get_default_query payload', async () => {
    invoke.mockResolvedValue(null)
    await getDefaultQuery(target)
    expect(invoke).toHaveBeenCalledWith('get_default_query', {
      connectionId: 'connection-1',
      database:     'app',
      collection:   'users',
    })
  })

  it('rejects with the command error unchanged', async () => {
    const error = { code: 'storage', message: 'read failed' }
    invoke.mockRejectedValue(error)
    await expect(getDefaultQuery(target)).rejects.toBe(error)
  })
})

describe('setDefaultQuery', () => {
  it('translates the target and entry into the set_default_query payload', async () => {
    invoke.mockResolvedValue(null)
    await setDefaultQuery(target, {
      mode:       'find',
      filter:     '{ a: 1 }',
      sort:       '{}',
      projection: '{}',
      skip:       0,
      limit:      50,
      pipeline:   '',
    })
    expect(invoke).toHaveBeenCalledWith('set_default_query', {
      connectionId: 'connection-1',
      database:     'app',
      collection:   'users',
      mode:         'find',
      filter:       '{ a: 1 }',
      sort:         '{}',
      projection:   '{}',
      skip:         0,
      limit:        50,
      pipeline:     '',
    })
  })
})

describe('clearDefaultQuery', () => {
  it('translates the target into the clear_default_query payload', async () => {
    invoke.mockResolvedValue(null)
    await clearDefaultQuery(target)
    expect(invoke).toHaveBeenCalledWith('clear_default_query', {
      connectionId: 'connection-1',
      database:     'app',
      collection:   'users',
    })
  })
})

describe('listSavedQueries', () => {
  it('calls list_saved_queries with no arguments', async () => {
    invoke.mockResolvedValue([])
    await listSavedQueries()
    expect(invoke).toHaveBeenCalledWith('list_saved_queries')
  })

  it('resolves with the command response unchanged', async () => {
    const response = [{ id: '1', name: 'q' }]
    invoke.mockResolvedValue(response)
    await expect(listSavedQueries()).resolves.toBe(response)
  })
})

describe('saveQuery', () => {
  it('translates the entry into the save_query payload', async () => {
    invoke.mockResolvedValue('new-id')
    await saveQuery({
      name:       'My query',
      mode:       'aggregate',
      filter:     '',
      sort:       '',
      projection: '',
      skip:       0,
      limit:      50,
      pipeline:   '[{ "$match": {} }]',
    })
    expect(invoke).toHaveBeenCalledWith('save_query', {
      name:       'My query',
      mode:       'aggregate',
      filter:     '',
      sort:       '',
      projection: '',
      skip:       0,
      limit:      50,
      pipeline:   '[{ "$match": {} }]',
    })
  })
})

describe('deleteSavedQuery', () => {
  it('translates the id into the delete_saved_query payload', async () => {
    invoke.mockResolvedValue(null)
    await deleteSavedQuery('query-1')
    expect(invoke).toHaveBeenCalledWith('delete_saved_query', { id: 'query-1' })
  })
})

describe('getQueryHistory', () => {
  it('translates the target into the get_query_history payload', async () => {
    invoke.mockResolvedValue([])
    await getQueryHistory(target)
    expect(invoke).toHaveBeenCalledWith('get_query_history', {
      connectionId: 'connection-1',
      database:     'app',
      collection:   'users',
    })
  })
})

describe('pushQueryHistory', () => {
  it('translates the target and entry into the push_query_history payload', async () => {
    invoke.mockResolvedValue(null)
    await pushQueryHistory(target, {
      mode:       'find',
      filter:     '{ a: 1 }',
      sort:       '{}',
      projection: '{}',
      skip:       0,
      limit:      50,
      pipeline:   '',
    })
    expect(invoke).toHaveBeenCalledWith('push_query_history', {
      connectionId: 'connection-1',
      database:     'app',
      collection:   'users',
      mode:         'find',
      filter:       '{ a: 1 }',
      sort:         '{}',
      projection:   '{}',
      skip:         0,
      limit:        50,
      pipeline:     '',
    })
  })
})

describe('clearQueryHistory', () => {
  it('translates the target into the clear_query_history payload', async () => {
    invoke.mockResolvedValue(null)
    await clearQueryHistory(target)
    expect(invoke).toHaveBeenCalledWith('clear_query_history', {
      connectionId: 'connection-1',
      database:     'app',
      collection:   'users',
    })
  })
})