import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  exportCollection,
  exportCollectionFields,
  importCollection,
  importCollectionMapped,
  importPreview,
  duplicateCollection,
  copyCollection,
  copyCollectionToConnection,
} from './transfer'

const target = { connectionId: 'connection-1', database: 'app', collection: 'users' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('exportCollection', () => {
  it('translates the target, path and format into the export_collection payload', async () => {
    invoke.mockResolvedValue(null)
    await exportCollection(target, '/tmp/users.json', 'json')
    expect(invoke).toHaveBeenCalledWith('export_collection', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      path:       '/tmp/users.json',
      format:     'json',
    })
  })
})

describe('exportCollectionFields', () => {
  it('translates the target, path, format, fields and options into the export_collection_fields payload', async () => {
    invoke.mockResolvedValue(3)
    const fields = [{ source: 'a', target: 'a' }]
    await exportCollectionFields(target, '/tmp/users.csv', 'csv', fields, { incremental: true, filter: '{ "a": 1 }' })
    expect(invoke).toHaveBeenCalledWith('export_collection_fields', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      path:       '/tmp/users.csv',
      format:     'csv',
      fields,
      incremental: true,
      filter:     '{ "a": 1 }',
    })
  })

  it('omits the incremental flag and filter when not provided', async () => {
    invoke.mockResolvedValue(3)
    await exportCollectionFields(target, '/tmp/users.csv', 'csv', [])
    expect(invoke).toHaveBeenCalledWith('export_collection_fields', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      path:       '/tmp/users.csv',
      format:     'csv',
      fields:     [],
    })
  })
})

describe('importCollection', () => {
  it('translates the target, path and format into the import_collection payload', async () => {
    invoke.mockResolvedValue(7)
    await importCollection(target, '/tmp/users.json', 'json')
    expect(invoke).toHaveBeenCalledWith('import_collection', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      path:       '/tmp/users.json',
      format:     'json',
    })
  })
})

describe('importCollectionMapped', () => {
  it('translates the target, path, format, mapping and csv options into the import_collection_mapped payload', async () => {
    invoke.mockResolvedValue(7)
    const mapping = [{ source: 'a', target: 'a' }]
    const csv = { delimiter: ',' }
    await importCollectionMapped(target, '/tmp/users.csv', 'csv', mapping, csv)
    expect(invoke).toHaveBeenCalledWith('import_collection_mapped', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      path:       '/tmp/users.csv',
      format:     'csv',
      mapping,
      csv,
    })
  })

  it('omits the csv options when not provided', async () => {
    invoke.mockResolvedValue(7)
    await importCollectionMapped(target, '/tmp/users.json', 'json', [])
    expect(invoke).toHaveBeenCalledWith('import_collection_mapped', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      path:       '/tmp/users.json',
      format:     'json',
      mapping:    [],
    })
  })
})

describe('importPreview', () => {
  it('translates the path, format, limit and csv options into the import_preview payload', async () => {
    invoke.mockResolvedValue({ columns: [], rows: [] })
    await importPreview('/tmp/users.csv', 'csv', 20, { delimiter: ',' })
    expect(invoke).toHaveBeenCalledWith('import_preview', {
      path:   '/tmp/users.csv',
      format: 'csv',
      limit:  20,
      csv:    { delimiter: ',' },
    })
  })

  it('omits the csv options when not provided', async () => {
    invoke.mockResolvedValue({ columns: [], rows: [] })
    await importPreview('/tmp/users.json', 'json', 1)
    expect(invoke).toHaveBeenCalledWith('import_preview', {
      path:   '/tmp/users.json',
      format: 'json',
      limit:  1,
    })
  })
})

describe('duplicateCollection', () => {
  it('translates the target and new name into the duplicate_collection payload', async () => {
    invoke.mockResolvedValue(9)
    await duplicateCollection(target, 'users_copy')
    expect(invoke).toHaveBeenCalledWith('duplicate_collection', {
      id:         'connection-1',
      database:   'app',
      source:     'users',
      target:     'users_copy',
    })
  })
})

describe('copyCollection', () => {
  it('translates the connection and source/target pairs into the copy_collection payload', async () => {
    invoke.mockResolvedValue(5)
    await copyCollection(
      'connection-1',
      { database: 'app', collection: 'users' },
      { database: 'other', collection: 'users' },
    )
    expect(invoke).toHaveBeenCalledWith('copy_collection', {
      id:                 'connection-1',
      sourceDatabase:     'app',
      sourceCollection:   'users',
      targetDatabase:     'other',
      targetCollection:   'users',
    })
  })
})

describe('copyCollectionToConnection', () => {
  it('translates the source and target connections into the copy_collection_to_connection payload', async () => {
    invoke.mockResolvedValue(5)
    await copyCollectionToConnection(
      'connection-1',
      { database: 'app', collection: 'users' },
      'connection-2',
      { database: 'other', collection: 'users' },
    )
    expect(invoke).toHaveBeenCalledWith('copy_collection_to_connection', {
      sourceId:           'connection-1',
      sourceDatabase:     'app',
      sourceCollection:   'users',
      targetId:           'connection-2',
      targetDatabase:     'other',
      targetCollection:   'users',
    })
  })
})