import { ref, computed, watch, onUnmounted } from 'vue'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
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
} from '../engines/mongodb/api/gridfs'
import { errText, errCode } from '../utils/errors'
import { bucketChoices, metadataEjson } from '../utils/gridfs'
import { useConfirmDelete } from './useConfirmDelete'
import { showToast } from '../stores/toast'
import { invalidateConnectionResources } from '../stores/connectionData'
import { selectedGridfsFile, clearGridfsSelection } from '../stores/gridfs'

// The GridFS browser behind GridFsModal: a database's buckets and files, and upload /
// download / delete / rename / edit-metadata, plus bucket copy and drop. `target` is a
// getter for `{ connectionId, connectionName, dbName, menuRequest? }`. Call `load()` once
// the modal mounts.
export function useGridfsBrowser(target) {
  const buckets = ref([])
  const selectedBucket = ref('fs')
  const files = ref([])
  const loading = ref(true)
  const busy = ref(false)
  const error = ref(null)
  const errorCode = ref(null)
  const { pendingId: pendingDelete, confirmDelete: confirmDeleteFile, reset: resetDelete } = useConfirmDelete()

  // Row selection, so the GridFS menu actions have a target file.
  const selectedId = ref(null)
  const selectedFile = computed(() => files.value.find(f => f.id === selectedId.value) || null)
  function selectFile(f) { selectedId.value = f.id }

  // Published to the store so useMenu can gate the file actions on it (#258). Mirrored
  // rather than owned there because the selection is derived from this dialog's own
  // file list, which it reloads; the store is cleared on unmount so the actions can't
  // stay enabled with no dialog open.
  watch(selectedFile, (file) => { selectedGridfsFile.value = file }, { immediate: true })
  onUnmounted(clearGridfsSelection)

  // Inline sub-forms driven by the menu actions.
  const renameTarget = ref(null)   // file being renamed
  const renameName = ref('')
  const metaTarget = ref(null)     // file whose metadata is being edited
  const metaText = ref('')
  const viewTarget = ref(null)     // file whose details are shown
  const copyBucketOpen = ref(false)
  const copyBucketName = ref('')
  const subError = ref(null)       // error for the active sub-form

  const db = () => ({ connectionId: target().connectionId, database: target().dbName })

  function fail(e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  }

  // The GridFS menu signals actions by setting { action, nonce } on the modal's own target;
  // dispatch each to the matching operation. `immediate` covers the case where the action was
  // set before this (lazily-loaded) modal mounted, so the first request is never dropped.
  watch(() => target().menuRequest && target().menuRequest.nonce, (nonce) => {
    if (nonce == null) return
    handleGridfsMenu(target().menuRequest.action)
  }, { immediate: true })

  function needFile() {
    if (!selectedFile.value) { showToast('Select a file first'); return false }
    return true
  }

  function handleGridfsMenu(action) {
    subError.value = null
    switch (action) {
      case 'gridfs:add':    upload(); return
      case 'gridfs:save':   if (needFile()) download(selectedFile.value); return
      case 'gridfs:remove': if (needFile()) confirmDelete(selectedFile.value); return
      case 'gridfs:view_file': if (needFile()) viewTarget.value = selectedFile.value; return
      case 'gridfs:rename':
        if (needFile()) { renameTarget.value = selectedFile.value; renameName.value = selectedFile.value.filename }
        return
      case 'gridfs:meta':
        if (needFile()) { metaTarget.value = selectedFile.value; metaText.value = '' }
        return
      case 'gridfs:copy_bucket': copyBucketName.value = ''; copyBucketOpen.value = true; return
      case 'gridfs:drop_bucket': dropBucket(); return
    }
  }

  // Runs one sub-form's write: errors land on the sub-form, and `busy` covers the call.
  async function subFormWrite(write) {
    busy.value = true
    subError.value = null
    try {
      await write()
    } catch (e) {
      subError.value = errText(e)
    } finally {
      busy.value = false
    }
  }

  async function doRename() {
    const file = renameTarget.value
    const name = renameName.value.trim()
    if (!file || !name) return
    await subFormWrite(async () => {
      await gridfsRename(db(), selectedBucket.value, file.id, name)
      showToast('File renamed')
      renameTarget.value = null
      await loadFiles()
    })
  }

  async function doSetMeta() {
    const file = metaTarget.value
    if (!file) return
    // Validate the metadata document up front (empty clears it).
    const metadata = metadataEjson(metaText.value)
    if (!metadata.ok) { subError.value = metadata.error; return }
    await subFormWrite(async () => {
      await gridfsSetMetadata(db(), selectedBucket.value, file.id, metadata.ejson)
      showToast('Metadata saved')
      metaTarget.value = null
      await loadFiles()
    })
  }

  async function doCopyBucket() {
    const name = copyBucketName.value.trim()
    if (!name) return
    const connectionId = target().connectionId
    await subFormWrite(async () => {
      await gridfsCopyBucket(db(), selectedBucket.value, name)
      invalidateConnectionResources(connectionId)
      showToast(`Bucket copied to "${name}"`)
      copyBucketOpen.value = false
      await loadBuckets()
    })
  }

  // Drop the selected bucket after a confirm. Uses the OS confirm dialog rather than a
  // bespoke UI since it's rare and irreversible.
  async function dropBucket() {
    const bucket = selectedBucket.value
    const ok = window.confirm(`Drop GridFS bucket "${bucket}" and all its files? This cannot be undone.`)
    if (!ok) return
    const connectionId = target().connectionId
    busy.value = true
    try {
      await gridfsDropBucket(db(), bucket)
      invalidateConnectionResources(connectionId)
      showToast(`Dropped bucket "${bucket}"`)
      selectedBucket.value = 'fs'
      await loadBuckets()
      await loadFiles()
    } catch (e) {
      error.value = errText(e)
    } finally {
      busy.value = false
    }
  }

  const bucketSelectOptions = computed(() => bucketChoices(buckets.value).map((b) => ({ value: b, label: b })))

  // Switching bucket reloads that bucket's files.
  function onBucket(bucket) {
    selectedBucket.value = bucket
    loadFiles()
  }

  async function loadBuckets() {
    try {
      buckets.value = await listGridfsBuckets(db())
      if (buckets.value.length && !buckets.value.includes(selectedBucket.value)) {
        selectedBucket.value = buckets.value[0]
      }
    } catch (e) {
      fail(e)
    }
  }

  async function loadFiles() {
    loading.value = true
    error.value = null
    resetDelete()
    try {
      files.value = await listGridfsFiles(db(), selectedBucket.value)
    } catch (e) {
      fail(e)
      files.value = []
    } finally {
      loading.value = false
    }
  }

  async function load() {
    await loadBuckets()
    await loadFiles()
  }

  async function upload() {
    let path
    try {
      path = await openDialog({ multiple: false })
    } catch (_) { return }
    if (!path) return
    const connectionId = target().connectionId
    busy.value = true
    try {
      await gridfsUpload(db(), selectedBucket.value, path)
      invalidateConnectionResources(connectionId)
      showToast('File uploaded')
      await loadBuckets()
      await loadFiles()
    } catch (e) {
      fail(e)
    } finally {
      busy.value = false
    }
  }

  async function download(file) {
    let dest
    try {
      dest = await saveDialog({ defaultPath: file.filename })
    } catch (_) { return }
    if (!dest) return
    busy.value = true
    try {
      await gridfsDownload(db(), selectedBucket.value, file.id, dest)
      showToast(`Downloaded ${file.filename}`)
    } catch (e) {
      fail(e)
    } finally {
      busy.value = false
    }
  }

  async function confirmDelete(file) {
    if (!confirmDeleteFile(file.id)) return
    busy.value = true
    try {
      await gridfsDelete(db(), selectedBucket.value, file.id)
      showToast(`Deleted ${file.filename}`)
      await loadFiles()
    } catch (e) {
      fail(e)
    } finally {
      busy.value = false
    }
  }

  return {
    buckets, selectedBucket, bucketSelectOptions, files, loading, busy, error, errorCode,
    pendingDelete, selectedId, selectedFile, selectFile,
    renameTarget, renameName, metaTarget, metaText, viewTarget, copyBucketOpen, copyBucketName, subError,
    load, onBucket, upload, download, confirmDelete, doRename, doSetMeta, doCopyBucket, dropBucket,
  }
}
