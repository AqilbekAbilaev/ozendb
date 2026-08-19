import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  runFind,
  runAggregate,
  cancelRun,
  countDocuments,
  searchCollections,
  mapReduce,
  translateSqlToMql,
  explainFind,
  explainAggregate,
  loadExplainStorage,
} from './queries'

const target = { connectionId: 'connection-1', database: 'app', collection: 'users' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runFind', () => {
  it('translates the target and query into the find_documents payload', async () => {
    invoke.mockResolvedValue({ documents: [], elapsedMs: 3 })
    await runFind(target, { filter: '{}', projection: '{}', sort: '{}', skip: 0, limit: 50 }, 'run-1')
    expect(invoke).toHaveBeenCalledWith('find_documents', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      filter:     '{}',
      projection: '{}',
      sort:       '{}',
      skip:       0,
      limit:      50,
      comment:    'run-1',
    })
  })

  it('resolves with the command response unchanged', async () => {
    const response = { documents: [{ a: 1 }], elapsedMs: 4 }
    invoke.mockResolvedValue(response)
    await expect(runFind(target, { filter: '{}', projection: '{}', sort: '{}', skip: 0, limit: 50 }, 'run-1')).resolves.toBe(response)
  })

  it('rejects with the command error unchanged', async () => {
    const error = { code: 'network', message: 'boom' }
    invoke.mockRejectedValue(error)
    await expect(runFind(target, { filter: '{}', projection: '{}', sort: '{}', skip: 0, limit: 50 }, 'run-1')).rejects.toBe(error)
  })
})

describe('runAggregate', () => {
  it('translates the target and pipeline into the run_aggregate payload', async () => {
    invoke.mockResolvedValue({ documents: [], elapsedMs: 2 })
    await runAggregate(target, '[{ "$match": { "a": 1 } }]', 'run-2')
    expect(invoke).toHaveBeenCalledWith('run_aggregate', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      pipeline:   '[{ "$match": { "a": 1 } }]',
      comment:    'run-2',
    })
  })

  it('resolves with the command response unchanged', async () => {
    const response = { documents: [{ a: 1 }], truncated: true, elapsedMs: 7 }
    invoke.mockResolvedValue(response)
    await expect(runAggregate(target, '[]', 'run-2')).resolves.toBe(response)
  })
})

describe('cancelRun', () => {
  it('translates the connection and run id into the kill_query payload', async () => {
    invoke.mockResolvedValue(1)
    await cancelRun('connection-1', 'run-3')
    expect(invoke).toHaveBeenCalledWith('kill_query', { id: 'connection-1', comment: 'run-3' })
  })

  it('rejects with the command error unchanged', async () => {
    const error = { code: 'command', message: 'no such op' }
    invoke.mockRejectedValue(error)
    await expect(cancelRun('connection-1', 'run-3')).rejects.toBe(error)
  })
})

describe('countDocuments', () => {
  it('translates the target and filter into the count_documents payload', async () => {
    invoke.mockResolvedValue(42)
    await countDocuments(target, '{ a: 1 }')
    expect(invoke).toHaveBeenCalledWith('count_documents', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      filter:     '{ a: 1 }',
    })
  })

  it('resolves with the command response unchanged', async () => {
    invoke.mockResolvedValue(7)
    await expect(countDocuments(target, '{}')).resolves.toBe(7)
  })

  it('rejects with the command error unchanged', async () => {
    const error = { code: 'mongo', message: 'count failed' }
    invoke.mockRejectedValue(error)
    await expect(countDocuments(target, '{}')).rejects.toBe(error)
  })
})

describe('searchCollections', () => {
  it('translates the target, term and options into the search_collections payload', async () => {
    invoke.mockResolvedValue({ hits: [], scanned: 0 })
    await searchCollections(target, 'needle', { collection: null, scope: 'both', matchCase: true, regex: false })
    expect(invoke).toHaveBeenCalledWith('search_collections', {
      id:         'connection-1',
      database:   'app',
      collection: null,
      term:       'needle',
      scope:      'both',
      matchCase:  true,
      regex:      false,
    })
  })

  it('omits options that were not provided', async () => {
    invoke.mockResolvedValue({ hits: [], scanned: 0 })
    await searchCollections(target, 'needle')
    expect(invoke).toHaveBeenCalledWith('search_collections', {
      id:         'connection-1',
      database:   'app',
      collection: null,
      term:       'needle',
    })
  })

  it('passes through the optional scan limit and max hits', async () => {
    invoke.mockResolvedValue({ hits: [], scanned: 0 })
    await searchCollections(target, 'needle', { scanLimit: 1000, maxHits: 50 })
    expect(invoke).toHaveBeenCalledWith('search_collections', {
      id:         'connection-1',
      database:   'app',
      collection: null,
      term:       'needle',
      scanLimit:  1000,
      maxHits:    50,
    })
  })
})

describe('mapReduce', () => {
  it('translates the target and script arguments into the map_reduce payload', async () => {
    invoke.mockResolvedValue({ results: [] })
    await mapReduce(target, {
      map:          'function() { emit(this.a, 1) }',
      reduce:       'function(k, v) { return Array.sum(v) }',
      finalize:     '',
      outCollection: 'counts',
    })
    expect(invoke).toHaveBeenCalledWith('map_reduce', {
      id:            'connection-1',
      database:      'app',
      collection:    'users',
      map:           'function() { emit(this.a, 1) }',
      reduce:        'function(k, v) { return Array.sum(v) }',
      finalize:      '',
      outCollection: 'counts',
    })
  })

  it('resolves with the command response unchanged', async () => {
    const response = { results: [{ _id: 'a', value: 2 }] }
    invoke.mockResolvedValue(response)
    await expect(mapReduce(target, { map: '() => {}', reduce: '() => {}', finalize: '', outCollection: '' })).resolves.toBe(response)
  })
})

describe('translateSqlToMql', () => {
  it('translates the sql text into the translate_sql payload', async () => {
    invoke.mockResolvedValue({ filter: '{}', projection: '{}', sort: '{}', skip: 0, limit: 50 })
    await translateSqlToMql('SELECT * FROM users')
    expect(invoke).toHaveBeenCalledWith('translate_sql', { sql: 'SELECT * FROM users' })
  })

  it('resolves with the command response unchanged', async () => {
    const response = { filter: '{}', projection: '{}', sort: '{}', skip: 0, limit: 50 }
    invoke.mockResolvedValue(response)
    await expect(translateSqlToMql('SELECT * FROM users')).resolves.toBe(response)
  })

  it('rejects with the command error unchanged', async () => {
    const error = { code: 'sql', message: 'bad FROM clause' }
    invoke.mockRejectedValue(error)
    await expect(translateSqlToMql('SELECT * FROM')).rejects.toBe(error)
  })
})

describe('explainFind', () => {
  it('translates the target, query and verbosity into the explain_query payload', async () => {
    invoke.mockResolvedValue({ ok: 1 })
    await explainFind(target, { filter: '{}', projection: '{}', sort: '{}', skip: 0, limit: 50 }, 'executionStats')
    expect(invoke).toHaveBeenCalledWith('explain_query', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      filter:     '{}',
      projection: '{}',
      sort:       '{}',
      skip:       0,
      limit:      50,
      verbosity:  'executionStats',
    })
  })
})

describe('explainAggregate', () => {
  it('translates the target, pipeline and verbosity into the explain_aggregate payload', async () => {
    invoke.mockResolvedValue({ ok: 1 })
    await explainAggregate(target, '[{ "$match": {} }]', 'queryPlanner')
    expect(invoke).toHaveBeenCalledWith('explain_aggregate', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      pipeline:   '[{ "$match": {} }]',
      verbosity:  'queryPlanner',
    })
  })
})

describe('loadExplainStorage', () => {
  it('calls collection_stats for the target and normalizes the sizes', async () => {
    invoke.mockResolvedValue({
      size: 1024,
      indexes: [{ name: '_id_', size: 8 }, { name: 'name_1', size: 16 }],
    })
    await expect(loadExplainStorage(target)).resolves.toEqual({
      dataSize: 1024,
      indexSizes: { _id_: 8, name_1: 16 },
    })
    expect(invoke).toHaveBeenCalledWith('collection_stats', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
    })
  })

  it('tolerates a stats response without indexes', async () => {
    invoke.mockResolvedValue({ size: 512 })
    await expect(loadExplainStorage(target)).resolves.toEqual({ dataSize: 512, indexSizes: {} })
  })

  it('rejects with the command error unchanged (caller treats it as best-effort)', async () => {
    const error = { code: 'mongo', message: 'not authorized' }
    invoke.mockRejectedValue(error)
    await expect(loadExplainStorage(target)).rejects.toBe(error)
  })
})