import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

import { invoke } from '@tauri-apps/api/core'
import {
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  moveConnectionToFolder,
} from './folders'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listFolders', () => {
  it('invokes list_folders without arguments', async () => {
    invoke.mockResolvedValue([])
    await listFolders()
    expect(invoke).toHaveBeenCalledWith('list_folders')
  })
})

describe('createFolder', () => {
  it('passes the name through to create_folder', async () => {
    invoke.mockResolvedValue({ id: 'f1' })
    await createFolder('Work')
    expect(invoke).toHaveBeenCalledWith('create_folder', { name: 'Work' })
  })
})

describe('renameFolder', () => {
  it('passes the id and name through to rename_folder', async () => {
    invoke.mockResolvedValue(null)
    await renameFolder('f1', 'Personal')
    expect(invoke).toHaveBeenCalledWith('rename_folder', { id: 'f1', name: 'Personal' })
  })
})

describe('deleteFolder', () => {
  it('passes the id through to delete_folder', async () => {
    invoke.mockResolvedValue(null)
    await deleteFolder('f1')
    expect(invoke).toHaveBeenCalledWith('delete_folder', { id: 'f1' })
  })
})

describe('moveConnectionToFolder', () => {
  it('passes the connection and folder ids through to move_connection_to_folder', async () => {
    invoke.mockResolvedValue(null)
    await moveConnectionToFolder('c1', 'f1')
    expect(invoke).toHaveBeenCalledWith('move_connection_to_folder', { id: 'c1', folderId: 'f1' })
  })

  it('passes a null folder id when moving the connection to the root', async () => {
    invoke.mockResolvedValue(null)
    await moveConnectionToFolder('c1', null)
    expect(invoke).toHaveBeenCalledWith('move_connection_to_folder', { id: 'c1', folderId: null })
  })
})