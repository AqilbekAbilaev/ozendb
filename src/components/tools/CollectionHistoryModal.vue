<script setup>
import { ref, onMounted } from 'vue'
import { listCollectionHistory, clearCollectionHistory, restoreHistory } from '../../engines/mongodb/api/documents'
import { errText, errCode } from '../../utils/errors'
import BaseIcon from '../base/BaseIcon.vue'
import BaseButton from '../base/BaseButton.vue'
import StateMessage from '../base/StateMessage.vue'
import BaseModal from '../base/BaseModal.vue'
import HintText from '../base/HintText.vue'
import BaseModalBody from '../base/BaseModalBody.vue'

// Collection History: the app's record of single-document changes (insert / update /
// delete) made to this collection, newest-first, each restorable — Studio-3T's
// undo-your-edits safety net. Opened from App.vue for a collection node.
const props = defineProps({
  target: { type: Object, required: true },  // { connId, connName, dbName, collName }
})
defineEmits(['close'])

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const entries = ref([])
const busyId = ref(null)   // entry currently being restored
const notice = ref(null)

async function load() {
  loading.value = true
  error.value = null
  errorCode.value = null
  try {
    entries.value = await listCollectionHistory(
      { connectionId: props.target.connId, database: props.target.dbName, collection: props.target.collName },
    )
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

const OP_LABEL = { insert: 'Inserted', update: 'Edited', delete: 'Deleted' }
const RESTORE_LABEL = { insert: 'Undo insert', update: 'Revert edit', delete: 'Restore' }

function whenText(ms) {
  try { return new Date(ms).toLocaleString() } catch (_) { return String(ms) }
}

// Compact id text: unwrap an ObjectId ({$oid}) to ObjectId("…"), else show the raw JSON.
function idText(docIdJson) {
  try {
    const parsed = JSON.parse(docIdJson)
    if (parsed && typeof parsed === 'object' && typeof parsed.$oid === 'string') {
      return `ObjectId("${parsed.$oid}")`
    }
    return typeof parsed === 'object' ? JSON.stringify(parsed) : String(parsed)
  } catch (_) {
    return docIdJson
  }
}

async function restore(entry) {
  busyId.value = entry.id
  notice.value = null
  error.value = null
  try {
    await restoreHistory(entry.id)
    notice.value = `${OP_LABEL[entry.op] || entry.op} document restored`
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    busyId.value = null
  }
}

async function clearAll() {
  try {
    await clearCollectionHistory(
      { connectionId: props.target.connId, database: props.target.dbName, collection: props.target.collName },
    )
    entries.value = []
    notice.value = 'History cleared'
  } catch (e) {
    error.value = errText(e)
  }
}
</script>

<template>
  <BaseModal :title="`Collection History — ${target.dbName}.${target.collName}`" width="640px" max-width="calc(100vw - 40px)" height="calc(100vh - 80px)" max-height="calc(100vh - 80px)" @close="$emit('close')">

      <BaseModalBody>
        <div class="ch-controls">
          <HintText dim v-if="!loading && !error">
            {{ entries.length }} recorded change{{ entries.length === 1 ? '' : 's' }}
            <span v-if="notice" class="ch-ok">· {{ notice }}</span>
          </HintText>
          <span class="ch-spacer"></span>
          <BaseButton size="sm" bordered :disabled="loading || !entries.length" @click="clearAll">
            <BaseIcon name="trash" :size="13" /> Clear history
          </BaseButton>
        </div>

        <StateMessage v-if="loading" mode="loading" label="Loading history…" />
        <StateMessage v-else-if="error" mode="error" :message="error" :code="errorCode" />
        <StateMessage
          v-else-if="!entries.length"
          mode="empty"
          label="No changes recorded yet"
        />
        <div v-else class="ch-list">
          <div v-for="entry in entries" :key="entry.id" class="ch-item">
            <span class="ch-op" :class="'op-' + entry.op">{{ OP_LABEL[entry.op] || entry.op }}</span>
            <div class="ch-mid">
              <code class="ch-id">{{ idText(entry.doc_id) }}</code>
              <span class="ch-when">{{ whenText(entry.at) }}</span>
            </div>
            <BaseButton
              size="sm"
              bordered
              :disabled="busyId === entry.id"
              @click="restore(entry)"
            >{{ busyId === entry.id ? 'Restoring…' : (RESTORE_LABEL[entry.op] || 'Restore') }}</BaseButton>
          </div>
        </div>
      </BaseModalBody>
    </BaseModal>
</template>

<style scoped>


.ch-controls { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.ch-ok { color: var(--green, #2f9e63); }
.ch-spacer { flex: 1; }

.ch-list { display: flex; flex-direction: column; gap: 6px; }
.ch-item {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 10px; border: 1px solid var(--border-soft); border-radius: 7px;
  background: var(--bg-field);
}
.ch-op {
  flex: none; font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .04em; padding: 2px 7px; border-radius: 4px;
  background: var(--bg-panel-2); color: var(--text-dim);
}
.ch-op.op-delete { color: var(--terra, #c9614f); }
.ch-op.op-update { color: var(--amber, #c6851f); }
.ch-op.op-insert { color: var(--accent); }
.ch-mid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ch-id { font-family: var(--mono); font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ch-when { font-size: 11px; color: var(--text-faint); }
</style>
