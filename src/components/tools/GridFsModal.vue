<script setup>
import { onMounted } from 'vue'
import { useGridfsBrowser } from '../../composables/useGridfsBrowser'
import { fmtUploadDate as fmtDate } from '../../utils/gridfs'
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

// Top-bar / tree GridFS browser for a database; everything it does lives in
// useGridfsBrowser.
const props = defineProps({
  target: { type: Object, required: true },  // { connectionId, connectionName, dbName, menuRequest? }
})
defineEmits(['close'])

const {
  selectedBucket, bucketSelectOptions, files, loading, busy, error, errorCode,
  pendingDelete, selectedId, selectFile,
  renameTarget, renameName, metaTarget, metaText, viewTarget, copyBucketOpen, copyBucketName, subError,
  load, onBucket, upload, download, confirmDelete, doRename, doSetMeta, doCopyBucket,
} = useGridfsBrowser(() => props.target)

onMounted(load)
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
