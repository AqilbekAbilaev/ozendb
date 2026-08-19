// Mongo GridFS API: bucket listing, file listing, upload/download/delete, rename,
// metadata, and bucket-level drop/copy. Every command is database-scoped and takes
// the bucket name; file commands add the file id.

import { invoke } from '@tauri-apps/api/core'
import { databasePayload } from './payload'

export function listGridfsBuckets(target) {
  return invoke('list_gridfs_buckets', databasePayload(target))
}

export function listGridfsFiles(target, bucket) {
  return invoke('list_gridfs_files', databasePayload(target, { bucket }))
}

export function gridfsUpload(target, bucket, path) {
  return invoke('gridfs_upload', databasePayload(target, { bucket, path }))
}

export function gridfsDownload(target, bucket, fileId, dest) {
  return invoke('gridfs_download', databasePayload(target, { bucket, fileId, dest }))
}

export function gridfsDelete(target, bucket, fileId) {
  return invoke('gridfs_delete', databasePayload(target, { bucket, fileId }))
}

export function gridfsRename(target, bucket, fileId, newName) {
  return invoke('gridfs_rename', databasePayload(target, { bucket, fileId, newName }))
}

export function gridfsSetMetadata(target, bucket, fileId, metadata) {
  return invoke('gridfs_set_metadata', databasePayload(target, { bucket, fileId, metadata }))
}

export function gridfsDropBucket(target, bucket) {
  return invoke('gridfs_drop_bucket', databasePayload(target, { bucket }))
}

export function gridfsCopyBucket(target, bucket, newBucket) {
  return invoke('gridfs_copy_bucket', databasePayload(target, { bucket, newBucket }))
}