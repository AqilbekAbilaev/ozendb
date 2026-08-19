import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  listGridfsBuckets,
  listGridfsFiles,
  gridfsUpload,
  gridfsDownload,
  gridfsDelete,
  gridfsRename,
  gridfsSetMetadata,
  gridfsDropBucket,
  gridfsCopyBucket,
} from './gridfs'

const target = { connectionId: 'connection-1', database: 'app' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listGridfsBuckets', () => {
  it('translates the target into the list_gridfs_buckets payload', async () => {
    invoke.mockResolvedValue(['fs'])
    await listGridfsBuckets(target)
    expect(invoke).toHaveBeenCalledWith('list_gridfs_buckets', {
      id:       'connection-1',
      database: 'app',
    })
  })
})

describe('listGridfsFiles', () => {
  it('translates the target and bucket into the list_gridfs_files payload', async () => {
    invoke.mockResolvedValue([])
    await listGridfsFiles(target, 'fs')
    expect(invoke).toHaveBeenCalledWith('list_gridfs_files', {
      id:       'connection-1',
      database: 'app',
      bucket:   'fs',
    })
  })
})

describe('gridfsUpload', () => {
  it('translates the target, bucket and path into the gridfs_upload payload', async () => {
    invoke.mockResolvedValue('file-id')
    await gridfsUpload(target, 'fs', '/tmp/photo.jpg')
    expect(invoke).toHaveBeenCalledWith('gridfs_upload', {
      id:       'connection-1',
      database: 'app',
      bucket:   'fs',
      path:     '/tmp/photo.jpg',
    })
  })
})

describe('gridfsDownload', () => {
  it('translates the target, bucket, file id and destination into the gridfs_download payload', async () => {
    invoke.mockResolvedValue(null)
    await gridfsDownload(target, 'fs', 'file-id', '/tmp/out.jpg')
    expect(invoke).toHaveBeenCalledWith('gridfs_download', {
      id:       'connection-1',
      database: 'app',
      bucket:   'fs',
      fileId:   'file-id',
      dest:     '/tmp/out.jpg',
    })
  })
})

describe('gridfsDelete', () => {
  it('translates the target, bucket and file id into the gridfs_delete payload', async () => {
    invoke.mockResolvedValue(null)
    await gridfsDelete(target, 'fs', 'file-id')
    expect(invoke).toHaveBeenCalledWith('gridfs_delete', {
      id:       'connection-1',
      database: 'app',
      bucket:   'fs',
      fileId:   'file-id',
    })
  })
})

describe('gridfsRename', () => {
  it('translates the target, bucket, file id and new name into the gridfs_rename payload', async () => {
    invoke.mockResolvedValue(null)
    await gridfsRename(target, 'fs', 'file-id', 'renamed.jpg')
    expect(invoke).toHaveBeenCalledWith('gridfs_rename', {
      id:       'connection-1',
      database: 'app',
      bucket:   'fs',
      fileId:   'file-id',
      newName:  'renamed.jpg',
    })
  })
})

describe('gridfsSetMetadata', () => {
  it('translates the target, bucket, file id and metadata into the gridfs_set_metadata payload', async () => {
    invoke.mockResolvedValue(null)
    await gridfsSetMetadata(target, 'fs', 'file-id', '{ "a": 1 }')
    expect(invoke).toHaveBeenCalledWith('gridfs_set_metadata', {
      id:       'connection-1',
      database: 'app',
      bucket:   'fs',
      fileId:   'file-id',
      metadata: '{ "a": 1 }',
    })
  })
})

describe('gridfsDropBucket', () => {
  it('translates the target and bucket into the gridfs_drop_bucket payload', async () => {
    invoke.mockResolvedValue(null)
    await gridfsDropBucket(target, 'fs')
    expect(invoke).toHaveBeenCalledWith('gridfs_drop_bucket', {
      id:       'connection-1',
      database: 'app',
      bucket:   'fs',
    })
  })
})

describe('gridfsCopyBucket', () => {
  it('translates the target, bucket and new bucket into the gridfs_copy_bucket payload', async () => {
    invoke.mockResolvedValue(null)
    await gridfsCopyBucket(target, 'fs', 'backup')
    expect(invoke).toHaveBeenCalledWith('gridfs_copy_bucket', {
      id:        'connection-1',
      database:  'app',
      bucket:    'fs',
      newBucket: 'backup',
    })
  })
})