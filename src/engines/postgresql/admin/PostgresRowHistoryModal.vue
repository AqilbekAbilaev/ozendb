<script setup>
import { ref, onMounted } from 'vue'
import { listRowHistory, clearRowHistory, undoRowEdit } from '../api/queries'
import { errText, errCode } from '../../../utils/errors'
import BaseIcon from '../../../components/base/BaseIcon.vue'
import BaseButton from '../../../components/base/BaseButton.vue'
import StateMessage from '../../../components/base/StateMessage.vue'
import BaseModal from '../../../components/base/BaseModal.vue'
import HintText from '../../../components/base/HintText.vue'
import BaseModalBody from '../../../components/base/BaseModalBody.vue'
import FlexSpacer from '../../../components/base/FlexSpacer.vue'

// Row History (ozendb-h4y): recorded `update_pg_row` edits for this table,
// newest-first, each undoable — the Postgres sibling of MongoDB's Collection
// History, scoped to grid row edits rather than whole documents.
const props = defineProps({
  target: { type: Object, required: true },  // { connectionId, database, schema, table }
})
defineEmits(['close'])

const loading = ref(true)
const error = ref(null)
const errorCode = ref(null)
const entries = ref([])
const busyId = ref(null)
const notice = ref(null)

async function load() {
  loading.value = true
  error.value = null
  errorCode.value = null
  try {
    entries.value = await listRowHistory(props.target)
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    loading.value = false
  }
}

onMounted(load)

function whenText(ms) {
  try { return new Date(ms).toLocaleString() } catch (_) { return String(ms) }
}

function keyText(key) {
  return key.map(c => `${c.column} = ${JSON.stringify(c.value)}`).join(', ')
}

async function undo(entry) {
  busyId.value = entry.id
  notice.value = null
  error.value = null
  try {
    await undoRowEdit(entry.id)
    notice.value = 'Edit undone'
  } catch (e) {
    error.value = errText(e)
    errorCode.value = errCode(e)
  } finally {
    busyId.value = null
  }
}

async function clearAll() {
  try {
    await clearRowHistory(props.target)
    entries.value = []
    notice.value = 'History cleared'
  } catch (e) {
    error.value = errText(e)
  }
}
</script>

<template>
  <BaseModal :title="`Row History — ${target.schema}.${target.table}`" width="640px" max-width="calc(100vw - 40px)" height="calc(100vh - 80px)" max-height="calc(100vh - 80px)" @close="$emit('close')">
    <BaseModalBody>
      <div class="rh-controls">
        <HintText dim v-if="!loading && !error">
          {{ entries.length }} recorded edit{{ entries.length === 1 ? '' : 's' }}
          <span v-if="notice" class="rh-ok">· {{ notice }}</span>
        </HintText>
        <FlexSpacer />
        <BaseButton size="sm" bordered :disabled="loading || !entries.length" @click="clearAll">
          <BaseIcon name="trash" :size="13" /> Clear history
        </BaseButton>
      </div>

      <StateMessage v-if="loading" mode="loading" label="Loading history…" />
      <StateMessage v-else-if="error" mode="error" :message="error" :code="errorCode" />
      <StateMessage v-else-if="!entries.length" mode="empty" label="No edits recorded yet" />
      <div v-else class="rh-list">
        <div v-for="entry in entries" :key="entry.id" class="rh-item">
          <div class="rh-mid">
            <code class="rh-key">{{ keyText(entry.key) }}</code>
            <span v-for="change in entry.changes" :key="change.column" class="rh-change">
              {{ change.column }}: <code>{{ JSON.stringify(change.before) }}</code> → <code>{{ JSON.stringify(change.after) }}</code>
            </span>
            <span class="rh-when">{{ whenText(entry.at) }}</span>
          </div>
          <BaseButton size="sm" bordered :disabled="busyId === entry.id" @click="undo(entry)">
            {{ busyId === entry.id ? 'Undoing…' : 'Undo' }}
          </BaseButton>
        </div>
      </div>
    </BaseModalBody>
  </BaseModal>
</template>

<style scoped>
.rh-controls { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.rh-ok { color: var(--green, #2f9e63); }

.rh-list { display: flex; flex-direction: column; gap: 6px; }
.rh-item {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 10px; border: 1px solid var(--border-soft); border-radius: 7px;
  background: var(--bg-field);
}
.rh-mid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.rh-key { font-family: var(--mono); font-size: 12px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rh-change { font-size: 12px; color: var(--text-dim); }
.rh-change code { font-family: var(--mono); color: var(--text); }
.rh-when { font-size: 11px; color: var(--text-faint); }
</style>
