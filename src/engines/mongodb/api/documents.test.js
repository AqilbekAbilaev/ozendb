import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  insertDocument,
  insertDocuments,
  replaceDocument,
  deleteDocument,
  updateMany,
  deleteMany,
  clearCollection,
  listCollectionHistory,
  clearCollectionHistory,
  restoreHistory,
  openDocumentWindow,
} from './documents'

const target = { connectionId: 'connection-1', database: 'app', collection: 'users' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('insertDocument', () => {
  it('translates the target and document into the insert_document payload', async () => {
    invoke.mockResolvedValue('new-id')
    await insertDocument(target, '{ "a": 1 }')
    expect(invoke).toHaveBeenCalledWith('insert_document', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      document:   '{ "a": 1 }',
    })
  })
})

describe('insertDocuments', () => {
  it('translates the target and documents into the insert_documents payload', async () => {
    invoke.mockResolvedValue(2)
    await insertDocuments(target, '[{ "a": 1 }, { "a": 2 }]')
    expect(invoke).toHaveBeenCalledWith('insert_documents', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      documents:  '[{ "a": 1 }, { "a": 2 }]',
    })
  })

  it('resolves with the inserted count unchanged', async () => {
    invoke.mockResolvedValue(3)
    await expect(insertDocuments(target, '[]')).resolves.toBe(3)
  })
})

describe('replaceDocument', () => {
  it('translates the target, id filter and replacement into the replace_document payload', async () => {
    invoke.mockResolvedValue(null)
    await replaceDocument(target, '{ "_id": { "$oid": "abc" } }', '{ "a": 2 }')
    expect(invoke).toHaveBeenCalledWith('replace_document', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      idFilter:   '{ "_id": { "$oid": "abc" } }',
      document:   '{ "a": 2 }',
    })
  })
})

describe('deleteDocument', () => {
  it('translates the target and id filter into the delete_document payload', async () => {
    invoke.mockResolvedValue(null)
    await deleteDocument(target, '{ "_id": { "$oid": "abc" } }')
    expect(invoke).toHaveBeenCalledWith('delete_document', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      idFilter:   '{ "_id": { "$oid": "abc" } }',
    })
  })
})

describe('updateMany', () => {
  it('translates the target, filter and update into the update_many payload', async () => {
    invoke.mockResolvedValue(5)
    await updateMany(target, '{ "a": 1 }', '{ "$set": { "b": 2 } }')
    expect(invoke).toHaveBeenCalledWith('update_many', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      filter:     '{ "a": 1 }',
      update:     '{ "$set": { "b": 2 } }',
      upsert:     false,
      multi:      false,
    })
  })

  it('passes upsert and multi through when provided', async () => {
    invoke.mockResolvedValue(5)
    await updateMany(target, '{ "a": 1 }', '{ "$set": { "b": 2 } }', { upsert: true, multi: true })
    expect(invoke).toHaveBeenCalledWith('update_many', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      filter:     '{ "a": 1 }',
      update:     '{ "$set": { "b": 2 } }',
      upsert:     true,
      multi:      true,
    })
  })
})

describe('deleteMany', () => {
  it('translates the target and filter into the delete_many payload', async () => {
    invoke.mockResolvedValue(4)
    await deleteMany(target, '{ "a": 1 }')
    expect(invoke).toHaveBeenCalledWith('delete_many', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
      filter:     '{ "a": 1 }',
    })
  })
})

describe('clearCollection', () => {
  it('translates the target into the clear_collection payload', async () => {
    invoke.mockResolvedValue(10)
    await clearCollection(target)
    expect(invoke).toHaveBeenCalledWith('clear_collection', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
    })
  })
})

describe('listCollectionHistory', () => {
  it('translates the target into the list_collection_history payload', async () => {
    invoke.mockResolvedValue([])
    await listCollectionHistory(target)
    expect(invoke).toHaveBeenCalledWith('list_collection_history', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
    })
  })
})

describe('clearCollectionHistory', () => {
  it('translates the target into the clear_collection_history payload', async () => {
    invoke.mockResolvedValue(null)
    await clearCollectionHistory(target)
    expect(invoke).toHaveBeenCalledWith('clear_collection_history', {
      id:         'connection-1',
      database:   'app',
      collection: 'users',
    })
  })
})

describe('restoreHistory', () => {
  it('translates the entry id into the restore_history payload', async () => {
    invoke.mockResolvedValue(null)
    await restoreHistory('entry-1')
    expect(invoke).toHaveBeenCalledWith('restore_history', { entryId: 'entry-1' })
  })
})

describe('openDocumentWindow', () => {
  it('passes the document target through to the open_document_window payload', async () => {
    invoke.mockResolvedValue(null)
    const documentTarget = {
      connectionId: 'connection-1',
      database:     'app',
      collection:   'users',
      docId:        'abc',
      mode:         'view',
    }
    await openDocumentWindow(documentTarget)
    expect(invoke).toHaveBeenCalledWith('open_document_window', { target: documentTarget })
  })
})