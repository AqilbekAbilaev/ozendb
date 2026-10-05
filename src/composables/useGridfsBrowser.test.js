import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('../engines/mongodb/api/gridfs', () => ({
  listGridfsBuckets: vi.fn(), listGridfsFiles: vi.fn(), gridfsUpload: vi.fn(), gridfsDownload: vi.fn(),
  gridfsDelete: vi.fn(), gridfsRename: vi.fn(), gridfsSetMetadata: vi.fn(), gridfsDropBucket: vi.fn(),
  gridfsCopyBucket: vi.fn(),
}))
vi.mock('../stores/toast', () => ({ showToast: vi.fn() }))
vi.mock('../stores/connectionData', () => ({ invalidateConnectionResources: vi.fn() }))

import { nextTick, reactive } from 'vue'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import * as api from '../engines/mongodb/api/gridfs'
import { showToast } from '../stores/toast'
import { invalidateConnectionResources } from '../stores/connectionData'
import { useGridfsBrowser } from './useGridfsBrowser'

const DB = { connectionId: 'c1', database: 'shop' }
const FILE = { id: 'f1', filename: 'report.pdf', length: 10 }

function browser(over = {}) {
  const target = reactive({ connectionId: 'c1', connectionName: 'Local', dbName: 'shop', menuRequest: null, ...over })
  return { target, gridfs: useGridfsBrowser(() => target) }
}

beforeEach(() => {
  vi.clearAllMocks()
  api.listGridfsBuckets.mockResolvedValue(['fs'])
  api.listGridfsFiles.mockResolvedValue([FILE])
  globalThis.window = { confirm: vi.fn(() => true) }
})
afterEach(() => { delete globalThis.window })

describe('loading', () => {
  it('lists the buckets, then the selected bucket\'s files', async () => {
    const { gridfs } = browser()
    await gridfs.load()
    expect(api.listGridfsBuckets).toHaveBeenCalledWith(DB)
    expect(api.listGridfsFiles).toHaveBeenCalledWith(DB, 'fs')
    expect(gridfs.files.value).toEqual([FILE])
    expect(gridfs.loading.value).toBe(false)
  })

  it('moves to the first bucket the server has when fs is not among them', async () => {
    api.listGridfsBuckets.mockResolvedValue(['videos'])
    const { gridfs } = browser()
    await gridfs.load()
    expect(gridfs.selectedBucket.value).toBe('videos')
    expect(gridfs.bucketSelectOptions.value.map(o => o.value)).toEqual(['fs', 'videos'])
  })

  it('shows a failed listing as the pane error with no files', async () => {
    api.listGridfsFiles.mockRejectedValue({ code: 'command', message: 'not authorized' })
    const { gridfs } = browser()
    await gridfs.load()
    expect(gridfs.error.value).toBe('not authorized')
    expect(gridfs.files.value).toEqual([])
  })
})

describe('menu requests', () => {
  it('asks for a file before acting on one', async () => {
    const { target } = browser()
    target.menuRequest = { action: 'gridfs:rename', nonce: 1 }
    await nextTick()
    expect(showToast).toHaveBeenCalledWith('Select a file first')
  })

  it('opens the rename form on the selected file, prefilled', async () => {
    const { target, gridfs } = browser()
    await gridfs.load()
    gridfs.selectFile(FILE)
    target.menuRequest = { action: 'gridfs:rename', nonce: 2 }
    await nextTick()
    expect(gridfs.renameTarget.value).toEqual(FILE)
    expect(gridfs.renameName.value).toBe('report.pdf')
  })

  it('handles a request made before the modal mounted', () => {
    const { gridfs } = browser({ menuRequest: { action: 'gridfs:copy_bucket', nonce: 3 } })
    expect(gridfs.copyBucketOpen.value).toBe(true)
  })
})

describe('sub-forms', () => {
  it('renames with the trimmed name, then closes and reloads', async () => {
    const { gridfs } = browser()
    gridfs.renameTarget.value = FILE
    gridfs.renameName.value = '  final.pdf '
    await gridfs.doRename()
    expect(api.gridfsRename).toHaveBeenCalledWith(DB, 'fs', 'f1', 'final.pdf')
    expect(gridfs.renameTarget.value).toBe(null)
    expect(api.listGridfsFiles).toHaveBeenCalled()
  })

  it('keeps a failed rename open with its error', async () => {
    api.gridfsRename.mockRejectedValue({ code: 'command', message: 'duplicate' })
    const { gridfs } = browser()
    gridfs.renameTarget.value = FILE
    gridfs.renameName.value = 'x'
    await gridfs.doRename()
    expect(gridfs.renameTarget.value).toEqual(FILE)
    expect(gridfs.subError.value).toBe('duplicate')
    expect(gridfs.busy.value).toBe(false)
  })

  it('refuses metadata that is not a document without calling the server', async () => {
    const { gridfs } = browser()
    gridfs.metaTarget.value = FILE
    gridfs.metaText.value = '[1]'
    await gridfs.doSetMeta()
    expect(api.gridfsSetMetadata).not.toHaveBeenCalled()
    expect(gridfs.subError.value).toBeTruthy()
  })

  it('clears metadata when the box is left empty', async () => {
    const { gridfs } = browser()
    gridfs.metaTarget.value = FILE
    gridfs.metaText.value = ''
    await gridfs.doSetMeta()
    expect(api.gridfsSetMetadata).toHaveBeenCalledWith(DB, 'fs', 'f1', '')
  })
})

describe('bucket and file writes', () => {
  it('drops a bucket only once confirmed, then falls back to fs', async () => {
    const { gridfs } = browser()
    gridfs.selectedBucket.value = 'videos'
    window.confirm.mockReturnValueOnce(false)
    await gridfs.dropBucket()
    expect(api.gridfsDropBucket).not.toHaveBeenCalled()

    await gridfs.dropBucket()
    expect(api.gridfsDropBucket).toHaveBeenCalledWith(DB, 'videos')
    expect(invalidateConnectionResources).toHaveBeenCalledWith('c1')
    expect(gridfs.selectedBucket.value).toBe('fs')
  })

  it('uploads the picked file, and does nothing when the picker is cancelled', async () => {
    const { gridfs } = browser()
    openDialog.mockResolvedValueOnce(null)
    await gridfs.upload()
    expect(api.gridfsUpload).not.toHaveBeenCalled()

    openDialog.mockResolvedValueOnce('/tmp/a.bin')
    await gridfs.upload()
    expect(api.gridfsUpload).toHaveBeenCalledWith(DB, 'fs', '/tmp/a.bin')
    expect(invalidateConnectionResources).toHaveBeenCalledWith('c1')
  })

  it('deletes a file on the second click only', async () => {
    const { gridfs } = browser()
    await gridfs.confirmDelete(FILE)
    expect(api.gridfsDelete).not.toHaveBeenCalled()
    expect(gridfs.pendingDelete.value).toBe('f1')
    await gridfs.confirmDelete(FILE)
    expect(api.gridfsDelete).toHaveBeenCalledWith(DB, 'fs', 'f1')
  })
})
