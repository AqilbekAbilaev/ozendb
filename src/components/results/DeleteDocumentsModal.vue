<script setup>
// Collection → Delete Dialog. Deletes every document matching a query filter. To
// scope the danger precisely, the user must first "Find matches" (a count) for the
// current query; only then does the Delete button enable, labelled with the exact
// number that will be removed. Editing the query invalidates the count so the delete
// can never run against a scope the user hasn't seen.
import { ref, computed, watch } from 'vue'
import { deleteMany } from '../../engines/mongodb/api/documents'
import { countDocuments } from '../../engines/mongodb/api/queries'
import { errText } from '../../utils/errors'
import { parseField } from '../../utils/queryParser'
import { predefinedQuery, hasSelectedDocs } from '../../utils/predefinedQuery'
import BaseIcon from '../base/BaseIcon.vue'
import BaseModal from '../base/BaseModal.vue'
import BaseModalBody from '../base/BaseModalBody.vue'
import BaseModalFoot from '../base/BaseModalFoot.vue'
import BaseSelect from '../base/BaseSelect.vue'
import BaseButton from '../base/BaseButton.vue'
import CodeEditor from '../base/CodeEditor.vue'
import FieldError from '../base/FieldError.vue'

const props = defineProps({
  activeTab: { type: Object, required: true },
})
const emit = defineEmits(['close', 'done'])

const preset  = ref('')            // "Apply predefined query" selection (shown in the dropdown)
const filter  = ref('{}')
const error   = ref(null)
const busy    = ref(false)
const validation = ref(null)       // inline Validate JSON feedback: `{ ok, text }`
const matched = ref(null)          // count for `countedFilter`, or null before/after edits
const countedFilter = ref(null)    // the exact filter text `matched` was counted for

// Any edit to the query invalidates a prior count — the Delete button re-locks.
watch(filter, () => { matched.value = null; countedFilter.value = null; validation.value = null })

const presetOptions = computed(() => [
  { value: 'selected', label: 'Selected Document(s)', disabled: !hasSelectedDocs(props.activeTab) },
  { value: 'current',  label: 'Search Query from Collection View' },
  { value: 'all',      label: 'All Documents' },
])

// Show the picked option in the dropdown and apply its query into the Query field.
function onPreset(kind) {
  preset.value = kind
  if (!kind) return
  filter.value = predefinedQuery(kind, props.activeTab)
}

// Validate JSON parses the query and reports the result inline, without touching the
// database.
function onValidate() {
  error.value = null
  const pf = parseField(filter.value)
  validation.value = pf.ok
    ? { ok: true, text: 'Query is valid JSON.' }
    : { ok: false, text: 'Query: ' + pf.error }
}

async function onCount() {
  error.value = null
  const pf = parseField(filter.value)
  if (!pf.ok) { error.value = 'Query: ' + pf.error; return }
  busy.value = true
  try {
    const total = await countDocuments(
      { connectionId: props.activeTab.connectionId, database: props.activeTab.dbName, collection: props.activeTab.collectionName },
      pf.ejson,
    )
    matched.value = total
    countedFilter.value = filter.value
  } catch (e) {
    error.value = errText(e)
  } finally {
    busy.value = false
  }
}

async function onDelete() {
  // Guard: only delete what was counted for the current, unchanged query.
  if (matched.value === null || countedFilter.value !== filter.value) return
  error.value = null
  const pf = parseField(filter.value)
  if (!pf.ok) { error.value = 'Query: ' + pf.error; return }
  busy.value = true
  try {
    const deleted = await deleteMany(
      { connectionId: props.activeTab.connectionId, database: props.activeTab.dbName, collection: props.activeTab.collectionName },
      pf.ejson,
    )
    emit('done', `Deleted ${deleted} document${deleted !== 1 ? 's' : ''}`)
  } catch (e) {
    error.value = errText(e)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <BaseModal title="Delete Documents" width="540px" max-width="94vw" @close="$emit('close')">
      <BaseModalBody>
        <div class="dw-hint">Deletes every document in
          <code>{{ activeTab.collectionName }}</code> that matches the query. This cannot be undone.</div>

        <label class="dw-row">
          <span class="dw-lbl">Query <span class="dw-note">(empty <code>{}</code> matches all)</span></span>
          <CodeEditor class="dw-editor" v-model="filter" />
        </label>

        <div class="pq-row">
          <span class="pq-lbl">Apply predefined query:</span>
          <BaseSelect class="pq-select" :model-value="preset" :options="presetOptions"
            placeholder="Choose…" @update:model-value="onPreset" />
        </div>

        <div class="dw-count" v-if="matched !== null && countedFilter === filter">
          <BaseIcon name="count" :size="14" />
          {{ matched.toLocaleString() }} document{{ matched !== 1 ? 's' : '' }} match this query.
        </div>

        <div v-if="validation" class="dw-msg" :class="{ ok: validation.ok, bad: !validation.ok }">
          <BaseIcon :name="validation.ok ? 'check' : 'close'" :size="13" />
          {{ validation.text }}
        </div>

        <FieldError :text="error" />
      </BaseModalBody>

      <BaseModalFoot>
        <template #left>
          <BaseButton @click="onValidate">Validate JSON</BaseButton>
          <BaseButton :disabled="busy" @click="onCount">Find matches</BaseButton>
        </template>
        <BaseButton @click="$emit('close')">Cancel</BaseButton>
        <BaseButton
          variant="danger"
          :disabled="busy || matched === null || countedFilter !== filter"
          @click="onDelete"
        >{{ matched !== null && countedFilter === filter ? `Delete ${matched.toLocaleString()}` : 'Delete' }}</BaseButton>
      </BaseModalFoot>
  </BaseModal>
</template>

<style scoped>
.dw-hint { font-size: 12.5px; color: var(--text-dim); line-height: 1.5; }
.dw-hint code, .dw-lbl code, .dw-note code { font-family: var(--mono); color: var(--text); }
.dw-row { display: flex; flex-direction: column; gap: 5px; }
.dw-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: var(--text-faint); }
.dw-note { text-transform: none; letter-spacing: 0; }
.dw-editor {
  /* ~10 rows: 13px font × 1.7 line-height + CodeMirror's content padding. */
  height: 230px; border: 1px solid var(--border); border-radius: 5px; overflow: hidden;
  background: var(--bg-input);
}
.dw-editor:focus-within { border-color: var(--accent); }
.pq-row { display: flex; align-items: center; gap: 10px; }
.pq-lbl { font-size: 12.5px; color: var(--text-dim); flex: none; }
.pq-select { flex: 1; min-width: 0; }
.dw-count { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text); }
.dw-msg { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
.dw-msg.ok { color: var(--success-text); }
.dw-msg.bad { color: var(--danger-text); }

</style>
