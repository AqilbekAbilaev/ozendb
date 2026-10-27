import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))
vi.mock('../api/gridfs', () => ({
  listGridfsBuckets: vi.fn(), listGridfsFiles: vi.fn(), gridfsUpload: vi.fn(), gridfsDownload: vi.fn(),
  gridfsDelete: vi.fn(), gridfsRename: vi.fn(), gridfsSetMetadata: vi.fn(), gridfsDropBucket: vi.fn(),
  gridfsCopyBucket: vi.fn(),
}))
vi.mock('../../../stores/toast', () => ({ showToast: vi.fn() }))
vi.mock('../../../stores/connectionData', () => ({ invalidateConnectionResources: vi.fn() }))

import { nextTick, reactive, effectScope } from 'vue'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import * as api from '../api/gridfs'
import { showToast } from '../../../stores/toast'
import { invalidateConnectionResources } from '../../../stores/connectionData'
import { useGridfsBrowser } from './useGridfsBrowser'
import { selectedGridfsFile, clearGridfsSelection } from '../../../stores/gridfs'
import { gridfsMenuRequest, requestGridfsAction } from '../../../stores/menuRequests'
import { createResourceRef } from '../../../utils/resourceRef'

const DB = { connectionId: 'c1', database: 'shop' }
const FILE = { id: 'f1', filename: 'report.pdf', length: 10 }

// One browser at a time, in its own effect scope: only one GridFS dialog is ever mounted,
// and the menu request it watches is module-scope state, so a leftover instance from an
// earlier test would take requests meant for the current one.
let scope = null
function browser(over = {}) {
  const target = reactive({
    resource: createResourceRef('c1', [{ kind: 'database', name: 'shop' }]),
    connectionName: 'Local', ...over,
  })
  scope?.stop()
  scope = effectScope()
  return { target, gridfs: scope.run(() => useGridfsBrowser(() => target)) }
}

beforeEach(() => {
  vi.clearAllMocks()
  clearGridfsSelection()
  gridfsMenuRequest.value = null
  api.listGridfsBuckets.mockResolvedValue(['fs'])
  api.listGridfsFiles.mockResolvedValue([FILE])
  globalThis.window = { confirm: vi.fn(() => true) }
})
afterEach(() => {
  scope?.stop()
  scope = null
  delete globalThis.window
})

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
    const { gridfs } = browser()
    await gridfs.load()
    requestGridfsAction('gridfs:rename')
    await nextTick()
    expect(showToast).toHaveBeenCalledWith('Select a file first')
  })

  it('opens the rename form on the selected file, prefilled', async () => {
    const { gridfs } = browser()
    await gridfs.load()
    gridfs.selectFile(FILE)
    requestGridfsAction('gridfs:rename')
    await nextTick()
    expect(gridfs.renameTarget.value).toEqual(FILE)
    expect(gridfs.renameName.value).toBe('report.pdf')
  })

  // A bucket action opens the dialog and signals in the same breath, so the request is
  // waiting before this instance exists. It is held until the listing is in, not dropped.
  it('holds a request made before the modal mounted until the listing is in', async () => {
    requestGridfsAction('gridfs:copy_bucket')
    const { gridfs } = browser()
    expect(gridfs.copyBucketOpen.value).toBe(false)
    await gridfs.load()
    expect(gridfs.copyBucketOpen.value).toBe(true)
  })

  // #288: the held action must run against the bucket the listing settled on. Acting at
  // start-up instead dropped 'fs' on a database whose only bucket is something else.
  it('runs a held bucket action on the listed bucket, not the fs default', async () => {
    api.listGridfsBuckets.mockResolvedValue(['videos'])
    requestGridfsAction('gridfs:drop_bucket')
    const { gridfs } = browser()
    await gridfs.load()
    expect(api.gridfsDropBucket).toHaveBeenCalledWith(DB, 'videos')
  })

  // #288: taking the request clears it, so the next dialog to open does not replay the
  // last menu action against a fresh, selection-less file list.
  it('takes the request, leaving nothing behind for the next dialog', async () => {
    const first = browser()
    await first.gridfs.load()
    requestGridfsAction('gridfs:copy_bucket')
    await nextTick()
    expect(first.gridfs.copyBucketOpen.value).toBe(true)
    expect(gridfsMenuRequest.value).toBe(null)

    const { gridfs } = browser()
    await gridfs.load()
    expect(gridfs.copyBucketOpen.value).toBe(false)
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

describe('the selection published for the GridFS menu', () => {
  it('publishes the selected file and follows a change of selection', async () => {
    const SECOND = { id: 'f2', filename: 'notes.txt', length: 4 }
    api.listGridfsFiles.mockResolvedValue([FILE, SECOND])
    const { gridfs } = browser()
    await gridfs.load()
    expect(selectedGridfsFile.value).toBe(null)

    gridfs.selectFile(FILE)
    await nextTick()
    expect(selectedGridfsFile.value).toMatchObject({ id: 'f1' })

    gridfs.selectFile(SECOND)
    await nextTick()
    expect(selectedGridfsFile.value).toMatchObject({ id: 'f2' })
  })

  it('clears on close, so the file actions cannot stay enabled with no dialog open', () => {
    selectedGridfsFile.value = FILE
    clearGridfsSelection()
    expect(selectedGridfsFile.value).toBe(null)
  })
})
