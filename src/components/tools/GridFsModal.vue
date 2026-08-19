<script setup>
import { ref, onMounted, computed, watch } from 'vue'
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
} from '../../engines/mongodb/api/gridfs'
import { errText, errCode } from '../../utils/errors'
import { useConfirmDelete } from '../../composables/useConfirmDelete'
import { useToast } from '../../composables/useToast'
import { parseField } from '../../utils/queryParser'
import BaseIcon from '../base/BaseIcon.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseSelect from '../base/BaseSelect.vue'
import StateMessage from '../base/StateMessage.vue'
import BaseButton from '../base/BaseButton.vue'
import BaseInput from '../base/BaseInput.vue'
import BaseTextarea from '../base/BaseTextarea.vue'
import FieldError from '../base/FieldError.vue'
import HintText from '../base/HintText.vue'
import BaseModalBody from '../base/BaseModalBody.vue'
import { fmtBytes } from '../../utils/format'

// Top-bar / tree GridFS browser for a database: list buckets, list files, and
// upload / download / delete / rename / edit-metadata files, plus bucket copy/drop.
const props = defineProps({
  target: { type: Object, required: true },  // { connId, connName, dbName, menuRequest? }
})
const emit = defineEmits(['close'])
const { showToast } = useToast()

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

// Inline sub-forms driven by the menu actions.
const renameTarget = ref(null)   // file being renamed
const renameName = ref('')
const metaTarget = ref(null)     // file whose metadata is being edited
const metaText = ref('')
const viewTarget = ref(null)     // file whose details are shown
const copyBucketOpen = ref(false)
const copyBucketName = ref('')
const subError = ref(null)       // error for the active sub-form

// The GridFS menu signals actions by setting { action, nonce } on the modal's own target;
// dispatch each to the matching operation. `immediate` covers the case where the action was
// set before this (lazily-loaded) modal mounted, so the first request is never dropped.
watch(() => props.target.menuRequest && props.target.menuRequest.nonce, (nonce) => {
  if (nonce == null) return
  handleGridfsMenu(props.target.menuRequest.action)
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

async function doRename() {
  const file = renameTarget.value
  const name = renameName.value.trim()
  if (!file || !name) return
  busy.value = true
  subError.value = null
  try {
    await gridfsRename(
      { connectionId: props.target.connId, database: props.target.dbName },
      selectedBucket.value,
      file.id,
      name,
    )
    showToast('File renamed')
    renameTarget.value = null
    await loadFiles()
  } catch (e) {
    subError.value = errText(e)
  } finally {
    busy.value = false
  }
}

async function doSetMeta() {
  const file = metaTarget.value
  if (!file) return
  // Validate the metadata document up front (empty clears it).
  const raw = metaText.value.trim()
  let ejson = ''
  if (raw !== '' && raw !== '{}') {
    const pf = parseField(raw)
    if (!pf.ok) { subError.value = pf.error; return }
    ejson = pf.ejson
  }
  busy.value = true
  subError.value = null
  try {
    await gridfsSetMetadata(
      { connectionId: props.target.connId, database: props.target.dbName },
      selectedBucket.value,
      file.id,
      ejson,
    )
    showToast('Metadata saved')
    metaTarget.value = null
    await loadFiles()
  } catch (e) {
    subError.value = errText(e)
  } finally {
    busy.value = false
  }
}

async function doCopyBucket() {
  const name = copyBucketName.value.trim()
  if (!name) return
  busy.value = true
  subError.value = null
  try {
    await gridfsCopyBucket(
      { connectionId: props.target.connId, database: props.target.dbName },
      selectedBucket.value,
      name,
    )
    showToast(`Bucket copied to "${name}"`)
    copyBucketOpen.value = false
    await loadBuckets()
  } catch (e) {
    subError.value = errText(e)
  } finally {
    busy.value = false
  }
}

// Drop the selected bucket after a confirm. Uses the OS confirm dialog rather than a
// bespoke UI since it's rare and irreversible.
async function dropBucket() {
  const bucket = selectedBucket.value
  const ok = window.confirm(`Drop GridFS bucket "${bucket}" and all its files? This cannot be undone.`)
  if (!ok) return
  busy.value = true
  try {
    await gridfsDropBucket(
      { connectionId: props.target.connId, database: props.target.dbName },
      bucket,
    )
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

// Always offer the default "fs" bucket even if it doesn't exist yet (an upload
// creates it), plus any discovered buckets.
const bucketOptions = computed(() => {
  const set = new Set(buckets.value)
  set.add('fs')
  return [...set].sort()
})
const bucketSelectOptions = computed(() => bucketOptions.value.map((b) => ({ value: b, label: b })))

// Switching bucket (was the native select's @change) reloads that bucket's files.
function onBucket(bucket) {
  selectedBucket.value = bucket
  onBucketChange()
}

async function loadBuckets() {
  try {
    buckets.value = await listGridfsBuckets(
      { connectionId: props.target.connId, database: props.target.dbName },
    )
    if (buckets.value.length && !buckets.value.includes(selectedBucket.value)) {
      selectedBucket.value = buckets.value[0]
    }
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  }
}

async function loadFiles() {
  loading.value = true
  error.value = null
  resetDelete()
  try {
    files.value = await listGridfsFiles(
      { connectionId: props.target.connId, database: props.target.dbName },
      selectedBucket.value,
    )
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
    files.value = []
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await loadBuckets()
  await loadFiles()
})

async function onBucketChange() {
  await loadFiles()
}

async function upload() {
  let path
  try {
    path = await openDialog({ multiple: false })
  } catch (_) { return }
  if (!path) return
  busy.value = true
  try {
    await gridfsUpload(
      { connectionId: props.target.connId, database: props.target.dbName },
      selectedBucket.value,
      path,
    )
    showToast('File uploaded')
    await loadBuckets()
    await loadFiles()
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
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
    await gridfsDownload(
      { connectionId: props.target.connId, database: props.target.dbName },
      selectedBucket.value,
      file.id,
      dest,
    )
    showToast(`Downloaded ${file.filename}`)
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    busy.value = false
  }
}

async function confirmDelete(file) {
  if (!confirmDeleteFile(file.id)) return
  busy.value = true
  try {
    await gridfsDelete(
      { connectionId: props.target.connId, database: props.target.dbName },
      selectedBucket.value,
      file.id,
    )
    showToast(`Deleted ${file.filename}`)
    await loadFiles()
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    busy.value = false
  }
}


function fmtDate(iso) {
  if (!iso) return '—'
  return iso.replace('T', ' ').replace(/\..*$/, '')
}
</script>

<template>
  <BaseModal :title="`GridFS — ${target.dbName}`" width="680px" max-width="92vw" @close="$emit('close')">
      <BaseModalBody>
        <div class="gf-controls">
          <label class="gf-f">
            Bucket
            <BaseSelect :model-value="selectedBucket" class="gf-select" :options="bucketSelectOptions"
              :disabled="busy" size="sm" @update:model-value="onBucket" />
          </label>
          <BaseButton variant="primary" size="sm" :disabled="busy" @click="upload">
            <BaseIcon name="import" :size="13" /> Upload file
          </BaseButton>
        </div>

        <StateMessage v-if="loading" mode="loading" label="Loading files…" />
        <StateMessage v-else-if="error" mode="error" :message="error" :code="errorCode" />
        <StateMessage v-else-if="!files.length" mode="empty" label="No files in this bucket" />
        <template v-else>
          <div class="gf-head">
            <span>Filename</span>
            <span>Size</span>
            <span>Uploaded</span>
            <span></span>
          </div>
          <div class="gf-rows">
            <div
              v-for="f in files"
              :key="f.id"
              class="gf-row"
              :class="{ selected: selectedId === f.id }"
              @click="selectFile(f)"
            >
              <span class="gf-name" :title="f.filename">{{ f.filename }}</span>
              <span class="gf-size">{{ fmtBytes(f.length) }}</span>
              <span class="gf-date">{{ fmtDate(f.upload_date) }}</span>
              <span class="gf-actions">
                <BaseButton icon="export" :icon-size="13" :disabled="busy" @click="download(f)" title="Download" />
                <BaseButton
                  icon="trash"
                  :icon-size="13"
                  :variant="pendingDelete === f.id ? 'danger' : 'default'"
                  :disabled="busy"
                  @click="confirmDelete(f)"
                  :title="pendingDelete === f.id ? 'Click again to confirm' : 'Delete'"
                />
              </span>
            </div>
          </div>
        </template>
      </BaseModalBody>
  </BaseModal>

  <!-- Rename file -->
  <BaseModal v-if="renameTarget" title="Rename File" width="440px" max-width="92vw" @close="renameTarget = null">
      <div class="sub-body">
        <BaseInput v-model="renameName" placeholder="New filename" @enter="doRename" />
        <FieldError :text="subError" />
      </div>
      <div class="sub-footer">
        <BaseButton @click="renameTarget = null">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="!renameName.trim() || busy" @click="doRename">Rename</BaseButton>
      </div>
  </BaseModal>

  <!-- Edit metadata -->
  <BaseModal v-if="metaTarget" :title="`Edit Metadata — ${metaTarget.filename}`" width="440px" max-width="92vw" @close="metaTarget = null">
      <div class="sub-body">
        <BaseTextarea v-model="metaText" class="sub-area" spellcheck="false" placeholder='{ "author": "…", "tags": [ … ] }'></BaseTextarea>
        <HintText>Sets the file's <code>metadata</code> document. Leave empty to clear.</HintText>
        <FieldError :text="subError" />
      </div>
      <div class="sub-footer">
        <BaseButton @click="metaTarget = null">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="busy" @click="doSetMeta">Save</BaseButton>
      </div>
  </BaseModal>

  <!-- View file details -->
  <BaseModal v-if="viewTarget" title="File Details" width="440px" max-width="92vw" @close="viewTarget = null">
      <div class="sub-body">
        <dl class="vf-list">
          <dt>Filename</dt><dd>{{ viewTarget.filename }}</dd>
          <dt>Size</dt><dd>{{ fmtBytes(viewTarget.length) }}</dd>
          <dt>Uploaded</dt><dd>{{ fmtDate(viewTarget.upload_date) }}</dd>
          <dt>Content type</dt><dd>{{ viewTarget.content_type || '—' }}</dd>
          <dt>File ID</dt><dd class="mono">{{ viewTarget.id }}</dd>
        </dl>
      </div>
      <div class="sub-footer">
        <BaseButton @click="viewTarget = null">Close</BaseButton>
      </div>
  </BaseModal>

  <!-- Copy bucket -->
  <BaseModal v-if="copyBucketOpen" :title="`Copy Bucket &quot;${selectedBucket}&quot;`" width="440px" max-width="92vw" @close="copyBucketOpen = false">
      <div class="sub-body">
        <BaseInput v-model="copyBucketName" placeholder="New bucket name" @enter="doCopyBucket" />
        <FieldError :text="subError" />
      </div>
      <div class="sub-footer">
        <BaseButton @click="copyBucketOpen = false">Cancel</BaseButton>
        <BaseButton variant="primary" :disabled="!copyBucketName.trim() || busy" @click="doCopyBucket">Copy</BaseButton>
      </div>
  </BaseModal>
</template>

<style scoped>


.gf-controls { display: flex; align-items: flex-end; gap: 14px; }
.gf-f { font-size: 12px; color: var(--text-dim); display: flex; flex-direction: column; gap: 4px; }
.gf-select { min-width: 160px; }

.gf-head, .gf-row {
  display: grid;
  grid-template-columns: 1fr 90px 150px 72px;
  gap: 10px;
  align-items: center;
}
.gf-head {
  padding: 0 6px 6px;
  border-bottom: 1px solid var(--border-soft);
  font-size: 11px;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: .04em;
}
.gf-rows { overflow-y: auto; display: flex; flex-direction: column; }
.gf-row {
  padding: 5px 6px;
  border-bottom: 1px solid var(--grid-line);
  font-size: 12.5px;
}
.gf-row:hover { background: var(--bg-hover); }
.gf-name {
  font-family: var(--mono);
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gf-size, .gf-date { color: var(--text-dim); }
.gf-actions { display: flex; gap: 4px; justify-content: flex-end; }

.gf-row.selected { background: var(--bg-active); box-shadow: inset 2px 0 0 var(--accent); }

/* Sub-form overlays (rename / metadata / view / copy bucket) sit above the modal. */
.sub-body { padding: 16px; display: flex; flex-direction: column; gap: 8px; }
.base-textarea.sub-area { min-height: 120px; }
.sub-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
.vf-list { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; font-size: 12.5px; }
.vf-list dt { color: var(--text-faint); }
.vf-list dd { margin: 0; color: var(--text); user-select: text; word-break: break-word; }
.vf-list dd.mono { font-family: var(--mono); font-size: 11.5px; }
</style>
